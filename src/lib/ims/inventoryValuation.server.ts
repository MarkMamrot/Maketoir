import type { RowDataPacket } from 'mysql2';
import { getIMSPool } from '@/services/IMSMySQLService';
import {
  buildHistoricalValuation,
  type HistoricalEpoch, type HistoricalLayer, type HistoricalMovement,
  type HistoricalStock, type HistoricalVariant, type ValuationMethod,
  type ValuationOwnership,
} from './inventoryValuation';

type Numeric = number | string;
type DbVariant = Omit<HistoricalVariant, 'current_cost'> & { current_cost: Numeric | null };
type DbStock = Omit<HistoricalStock, 'qty_on_hand'> & { qty_on_hand: Numeric };
type DbMovement = Omit<HistoricalMovement, 'qty_change' | 'qty_after_soh' | 'unit_cost' | 'average_cost_after' | 'cost_repaired'> & {
  qty_change: Numeric; qty_after_soh: Numeric; unit_cost: Numeric | null;
  average_cost_after: Numeric | null; cost_repaired: number;
};
type DbLayer = Omit<HistoricalLayer, 'original_quantity' | 'unit_cost' | 'allocations'> & {
  original_quantity: Numeric; unit_cost: Numeric;
};

function numeric(value: Numeric): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error('Inventory valuation encountered an invalid recorded number.');
  return result;
}
const optionalNumeric = (value: Numeric | null) => value == null ? null : numeric(value);

export async function loadHistoricalValuation(businessId: string, cutoff: string, filters: {
  brand: string; supplierId: string; productType: string; productId: string; ownership?: ValuationOwnership;
}) {
  const connection = await getIMSPool().getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const [epochs] = await connection.query<(HistoricalEpoch & RowDataPacket)[]>(
      `SELECT id, method, started_at FROM ims_inventory_cost_epochs
        WHERE business_id = ? ORDER BY started_at, id`, [businessId],
    );
    const epoch = [...epochs].reverse().find(e => e.started_at < cutoff);
    const [states] = await connection.query<({ active_method: ValuationMethod; active_epoch_id: number | null } & RowDataPacket)[]>(
      'SELECT active_method, active_epoch_id FROM ims_inventory_cost_state WHERE business_id = ? LIMIT 1', [businessId],
    );
    const state = states[0];
    if (state?.active_method === 'fifo' && !state.active_epoch_id) {
      throw new Error('FIFO costing is active but has no valid valuation epoch.');
    }
    if (state?.active_method === 'fifo' && !epochs.some(e => Number(e.id) === Number(state.active_epoch_id))) {
      throw new Error('The active FIFO valuation epoch is missing from recorded costing history.');
    }
    const conditions = ['p.business_id = ?', 'v.variant_id > ?'];
    if (filters.ownership !== 'all') {
      conditions.push(`COALESCE(ownership_history.is_consignment, 0) = ${filters.ownership === 'consignment' ? '1' : '0'}`);
    }
    if (filters.productId) conditions.push('v.variant_id = ?');
    if (filters.brand) conditions.push('p.brand = ?');
    if (filters.supplierId) conditions.push('p.supplier_contact_id = ?');
    if (filters.productType) conditions.push('p.product_type = ?');
    const filterValues = [
      ...(filters.productId ? [filters.productId] : []),
      ...(filters.brand ? [filters.brand] : []),
      ...(filters.supplierId ? [Number(filters.supplierId)] : []),
      ...(filters.productType ? [filters.productType] : []),
    ];
    const results: ReturnType<typeof buildHistoricalValuation>[] = [];
    let after = '';
    for (;;) {
      const [catalogue] = await connection.query<(DbVariant & RowDataPacket)[]>(
        `SELECT v.variant_id, v.sku, p.name, p.brand, c.name AS supplier_name, v.created_at,
                COALESCE(NULLIF(v.avg_cost, 0), v.cost_aud) AS current_cost,
                COALESCE(ownership_history.is_consignment, 0) AS is_consignment
           FROM ims_product_variants v
           JOIN ims_products p ON p.product_id = v.product_id
           LEFT JOIN ims_contacts c ON c.id = p.supplier_contact_id
           LEFT JOIN ims_consignment_ownership_history ownership_history
             ON ownership_history.id = (
               SELECT history.id FROM ims_consignment_ownership_history history
                WHERE history.business_id = p.business_id AND history.product_id = p.product_id
                  AND history.effective_at < ?
                ORDER BY history.effective_at DESC, history.id DESC LIMIT 1
             )
          WHERE ${conditions.join(' AND ')}
          ORDER BY v.variant_id LIMIT 1000`,
        [cutoff, businessId, after, ...filterValues],
      );
      if (!catalogue.length) break;
      const ids = catalogue.map(v => v.variant_id);
      const placeholders = ids.map(() => '?').join(',');
      const scope = [businessId, ...ids];
      const [stock] = await connection.query<(DbStock & RowDataPacket)[]>(
        `SELECT variant_id, location_id, qty_on_hand FROM ims_stock
          WHERE (business_id = ? OR business_id = '') AND variant_id IN (${placeholders})`, scope,
      );
      const [movements] = await connection.query<(DbMovement & RowDataPacket)[]>(
        `SELECT m.id, m.variant_id, m.location_id, m.movement_type, m.qty_change,
                m.qty_after_soh, m.unit_cost, m.cost_method_snapshot, m.cost_epoch_id, m.created_at,
                CASE WHEN m.movement_type = 'build_output_produced' THEN b.output_avg_cost_after
                     WHEN m.movement_type = 'build_output_reversed' THEN r.output_avg_cost_after
                     ELSE NULL END AS average_cost_after,
                EXISTS(SELECT 1 FROM ims_cogs_cost_repairs repair
                        WHERE repair.business_id = ? AND repair.movement_id = m.id) AS cost_repaired
           FROM ims_stock_movements m
           LEFT JOIN ims_product_build_items b
             ON b.id = m.reference_id AND BINARY b.business_id = BINARY m.business_id
            AND m.reference_type = 'product_build' AND m.movement_type = 'build_output_produced'
           LEFT JOIN ims_product_build_reversals r
             ON r.id = m.reference_id AND BINARY r.business_id = BINARY m.business_id
            AND m.reference_type = 'product_build_reversal' AND m.movement_type = 'build_output_reversed'
          WHERE (m.business_id = ? OR m.business_id = '') AND m.variant_id IN (${placeholders})
          ORDER BY m.created_at, m.id`, [businessId, ...scope],
      );
      const variants = catalogue.map(v => ({
        ...v, current_cost: optionalNumeric(v.current_cost), is_consignment: Number(v.is_consignment ?? 0) === 1,
      }));
      if (state?.active_method === 'fifo') {
        const [currentCosts] = await connection.query<({ variant_id: string; quantity: Numeric; value: Numeric } & RowDataPacket)[]>(
          `SELECT variant_id, SUM(remaining_quantity) AS quantity,
                  SUM(remaining_quantity * unit_cost) AS value
             FROM ims_fifo_cost_layers
            WHERE business_id = ? AND epoch_id = ? AND variant_id IN (${placeholders})
            GROUP BY variant_id`, [businessId, state.active_epoch_id, ...ids],
        );
        const byId = new Map(currentCosts.map(c => [c.variant_id, c]));
        for (const variant of variants) {
          const current = byId.get(variant.variant_id);
          if (current && numeric(current.quantity) > 0) {
            variant.current_cost = numeric(current.value) / numeric(current.quantity);
          }
        }
      }
      const layers: HistoricalLayer[] = [];
      if (epoch?.method === 'fifo') {
        const [dbLayers] = await connection.query<(DbLayer & RowDataPacket)[]>(
          `SELECT id, variant_id, location_id, original_quantity, unit_cost, created_at
             FROM ims_fifo_cost_layers
            WHERE business_id = ? AND epoch_id = ? AND variant_id IN (${placeholders})
              AND created_at < ?`, [businessId, epoch.id, ...ids, cutoff],
        );
        const [allocations] = await connection.query<({
          layer_id: number; quantity: Numeric; allocation_type: string; created_at: string;
        } & RowDataPacket)[]>(
          `SELECT a.layer_id, a.quantity, a.allocation_type, a.created_at
             FROM ims_fifo_cost_allocations a
             JOIN ims_fifo_cost_layers l ON l.id = a.layer_id AND BINARY l.business_id = BINARY a.business_id
            WHERE a.business_id = ? AND a.epoch_id = ? AND l.variant_id IN (${placeholders})
              AND a.created_at < ?`, [businessId, epoch.id, ...ids, cutoff],
        );
        const byLayer = new Map<number, HistoricalLayer['allocations']>();
        for (const allocation of allocations) {
          const group = byLayer.get(Number(allocation.layer_id)) ?? [];
          group.push({ ...allocation, quantity: numeric(allocation.quantity) });
          byLayer.set(Number(allocation.layer_id), group);
        }
        for (const layer of dbLayers) layers.push({
          ...layer, id: Number(layer.id), original_quantity: numeric(layer.original_quantity),
          unit_cost: numeric(layer.unit_cost), allocations: byLayer.get(Number(layer.id)) ?? [],
        });
      }
      results.push(buildHistoricalValuation({
        variants,
        stock: stock.map(s => ({ ...s, qty_on_hand: numeric(s.qty_on_hand) })),
        movements: movements.map(m => ({
          ...m, qty_change: numeric(m.qty_change), qty_after_soh: numeric(m.qty_after_soh),
          unit_cost: optionalNumeric(m.unit_cost), average_cost_after: optionalNumeric(m.average_cost_after),
          cost_epoch_id: m.cost_epoch_id == null ? null : Number(m.cost_epoch_id), cost_repaired: Boolean(m.cost_repaired),
        })),
        layers, epochs, cutoff,
      }));
      after = catalogue[catalogue.length - 1].variant_id;
    }
    await connection.commit();
    const combined = buildHistoricalValuation({ variants: [], stock: [], movements: [], layers: [], epochs, cutoff });
    for (const result of results) {
      combined.data.push(...result.data);
      combined.reconciliation.mismatches.push(...result.reconciliation.mismatches);
      combined.reconciliation.stock_quantity += result.reconciliation.stock_quantity;
      combined.reconciliation.valued_quantity += result.reconciliation.valued_quantity;
      for (const key of Object.keys(combined.warnings) as Array<keyof typeof combined.warnings>) {
        combined.warnings[key] += result.warnings[key];
      }
    }
    combined.data.sort((a, b) => (a.brand ?? '').localeCompare(b.brand ?? '')
      || a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku));
    const reconciliation = combined.reconciliation;
    reconciliation.mismatched_sku_count = new Set(reconciliation.mismatches.map(m => m.variant_id)).size;
    reconciliation.mismatched_location_count = reconciliation.mismatches.length;
    reconciliation.status = reconciliation.mismatches.length ? 'mismatch' : 'balanced';
    return combined;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
