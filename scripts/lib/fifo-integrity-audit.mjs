const IDENTIFIER = /^[A-Za-z0-9_]+$/;

function schemaName(value) {
  if (!IDENTIFIER.test(value)) throw new Error('Invalid tenant schema name.');
  return `\`${value}\``;
}

function number(value) {
  return Number(value ?? 0);
}

function finding(code, count, sampleIds = []) {
  return { code, count: number(count), sampleIds: sampleIds.map(number) };
}

export async function auditFifoTenant(connection, input) {
  const schema = schemaName(input.schema);
  const businessId = String(input.businessId ?? '').trim();
  if (!businessId) throw new Error('A business ID is required for FIFO integrity audit.');

  const findings = [];
  const [stateRows] = await connection.query(
    `SELECT state.id, state.active_method, state.active_epoch_id,
            epoch.business_id AS epoch_business_id, epoch.method AS epoch_method,
            epoch.status AS epoch_status,
            (SELECT COUNT(*) FROM ${schema}.ims_inventory_cost_epochs active_epoch
              WHERE active_epoch.business_id = state.business_id AND active_epoch.status = 'active') AS active_epoch_count
       FROM ${schema}.ims_inventory_cost_state state
       LEFT JOIN ${schema}.ims_inventory_cost_epochs epoch ON epoch.id = state.active_epoch_id
      WHERE state.business_id = ?`,
    [businessId],
  );
  for (const state of stateRows) {
    const invalid = state.active_method === 'fifo'
      ? state.active_epoch_id == null
        || state.epoch_business_id !== businessId
        || state.epoch_method !== 'fifo'
        || state.epoch_status !== 'active'
        || number(state.active_epoch_count) !== 1
      : state.active_epoch_id != null || number(state.active_epoch_count) !== 0;
    if (invalid) findings.push(finding('invalid_costing_state', 1, [state.id]));
  }

  const [balanceRows] = await connection.query(
    `SELECT position.location_id, COUNT(*) AS mismatch_count
       FROM (
         SELECT combined.variant_id, combined.location_id,
                SUM(combined.stock_quantity) AS stock_quantity,
                SUM(combined.layer_quantity) AS layer_quantity
           FROM (
             SELECT BINARY stock.variant_id AS variant_id, stock.location_id,
                    SUM(stock.qty_on_hand) AS stock_quantity, 0 AS layer_quantity
               FROM ${schema}.ims_stock stock
               JOIN ${schema}.ims_inventory_cost_state state
                 ON BINARY state.business_id = BINARY stock.business_id
                AND state.active_method = 'fifo' AND state.active_epoch_id IS NOT NULL
              WHERE stock.business_id = ?
              GROUP BY stock.variant_id, stock.location_id
             UNION ALL
             SELECT BINARY layer.variant_id AS variant_id, layer.location_id,
                    0 AS stock_quantity, SUM(layer.remaining_quantity) AS layer_quantity
               FROM ${schema}.ims_fifo_cost_layers layer
               JOIN ${schema}.ims_inventory_cost_state state
                 ON BINARY state.business_id = BINARY layer.business_id
                AND state.active_method = 'fifo' AND state.active_epoch_id = layer.epoch_id
              WHERE layer.business_id = ?
              GROUP BY layer.variant_id, layer.location_id
           ) combined
          GROUP BY combined.variant_id, combined.location_id
         HAVING ABS(SUM(combined.stock_quantity) - SUM(combined.layer_quantity)) > 0.0001
       ) position
      GROUP BY position.location_id
      ORDER BY position.location_id`,
    [businessId, businessId],
  );
  const balanceCount = balanceRows.reduce((sum, row) => sum + number(row.mismatch_count), 0);
  if (balanceCount) findings.push(finding('stock_layer_location_mismatch', balanceCount, balanceRows.map(row => row.location_id)));

  const [invalidLayerRows] = await connection.query(
    `SELECT id FROM ${schema}.ims_fifo_cost_layers
      WHERE business_id = ?
        AND (original_quantity <= 0 OR remaining_quantity < 0
          OR remaining_quantity > original_quantity + 0.0001 OR unit_cost < 0)
      ORDER BY id LIMIT 20`,
    [businessId],
  );
  if (invalidLayerRows.length) findings.push(finding('invalid_layer_bounds', invalidLayerRows.length, invalidLayerRows.map(row => row.id)));

  const [[zeroCostColumn]] = await connection.query(
    `SELECT COUNT(*) AS column_count
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_fifo_cost_layers'
        AND COLUMN_NAME = 'zero_cost_reason'`,
    [input.schema],
  );
  const hasZeroCostReason = number(zeroCostColumn?.column_count) === 1;
  const [unreasonedZeroCostRows] = await connection.query(
    `SELECT id FROM ${schema}.ims_fifo_cost_layers
      WHERE business_id = ? AND ROUND(unit_cost, 6) = 0
        ${hasZeroCostReason ? 'AND zero_cost_reason IS NULL' : ''}
      ORDER BY id LIMIT 20`,
    [businessId],
  );
  if (unreasonedZeroCostRows.length) {
    findings.push(finding(
      'zero_cost_layer_without_reason',
      unreasonedZeroCostRows.length,
      unreasonedZeroCostRows.map(row => row.id),
    ));
  }

  const [orphanAllocationRows] = await connection.query(
    `SELECT allocation.id
       FROM ${schema}.ims_fifo_cost_allocations allocation
       LEFT JOIN ${schema}.ims_fifo_cost_layers layer
         ON layer.id = allocation.layer_id AND BINARY layer.business_id = BINARY allocation.business_id
       LEFT JOIN ${schema}.ims_stock_movements movement
         ON movement.id = allocation.stock_movement_id AND BINARY movement.business_id = BINARY allocation.business_id
      WHERE allocation.business_id = ?
        AND (allocation.quantity <= 0 OR allocation.unit_cost < 0 OR allocation.allocated_value < 0
          OR layer.id IS NULL OR movement.id IS NULL OR layer.epoch_id <> allocation.epoch_id
          OR movement.cost_epoch_id <> allocation.epoch_id)
      ORDER BY allocation.id LIMIT 20`,
    [businessId],
  );
  if (orphanAllocationRows.length) findings.push(finding('invalid_or_orphaned_allocation', orphanAllocationRows.length, orphanAllocationRows.map(row => row.id)));

  const [movementRows] = await connection.query(
    `SELECT movement.id
       FROM ${schema}.ims_stock_movements movement
       LEFT JOIN (
         SELECT business_id, epoch_id, stock_movement_id,
                SUM(quantity) AS allocated_quantity,
                SUM(allocated_value) AS allocated_value
           FROM ${schema}.ims_fifo_cost_allocations
          GROUP BY business_id, epoch_id, stock_movement_id
       ) allocation
         ON BINARY allocation.business_id = BINARY movement.business_id
        AND allocation.epoch_id = movement.cost_epoch_id
        AND allocation.stock_movement_id = movement.id
       LEFT JOIN (
         SELECT business_id, epoch_id, source_movement_id,
                SUM(original_quantity) AS source_quantity,
                SUM(original_quantity * unit_cost) AS source_value
           FROM ${schema}.ims_fifo_cost_layers
          WHERE source_movement_id IS NOT NULL
          GROUP BY business_id, epoch_id, source_movement_id
       ) source_layer
         ON BINARY source_layer.business_id = BINARY movement.business_id
        AND source_layer.epoch_id = movement.cost_epoch_id
        AND source_layer.source_movement_id = movement.id
      WHERE movement.business_id = ? AND movement.cost_method_snapshot = 'fifo'
        AND (
          movement.cost_epoch_id IS NULL
          OR ABS(ABS(movement.qty_change) - COALESCE(allocation.allocated_quantity, source_layer.source_quantity, 0)) > 0.0001
          OR (ABS(movement.qty_change) > 0.0001 AND movement.unit_cost IS NULL)
          OR (ABS(movement.qty_change) > 0.0001
            AND ABS(ABS(movement.qty_change) * movement.unit_cost
              - COALESCE(allocation.allocated_value, source_layer.source_value, 0)) > 0.01)
        )
      ORDER BY movement.id LIMIT 20`,
    [businessId],
  );
  if (movementRows.length) findings.push(finding('fifo_movement_coverage_mismatch', movementRows.length, movementRows.map(row => row.id)));

  return {
    schema: input.schema,
    status: findings.length ? 'mismatch' : 'balanced',
    findings,
  };
}
