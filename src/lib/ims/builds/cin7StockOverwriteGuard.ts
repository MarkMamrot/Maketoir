import { imsQuery } from '@/services/IMSMySQLService';
import { FifoCostingConflict } from '../costing/fifoCostingService';
import { ConsignmentConflict } from '../consignment/ownership';

export const CIN7_BUILD_STOCK_GUARD_MESSAGE = 'Cin7 stock replacement is blocked because completed product builds exist. Reconcile differences with Stocktakes or audited stock adjustments so build history and stock on hand remain aligned.';
export const CIN7_FIFO_STOCK_GUARD_MESSAGE = 'Cin7 stock replacement is blocked while FIFO costing is active because a quantity overwrite has no cost-layer history. Reconcile differences with a reviewed Stocktake instead.';

export async function assertCin7StockOverwriteAllowed(businessId: string): Promise<void> {
  const consignment = await imsQuery<{ id: number }>('SELECT id FROM ims_contacts WHERE business_id = ? AND is_consignment = 1 LIMIT 1', [businessId]);
  if (consignment.length) throw new ConsignmentConflict('Cin7 stock replacement is blocked for consignment businesses because imported quantities have no immutable supplier receipt evidence. Use audited IMS receipts and Stocktakes.');
  const costingRows = await imsQuery<{ active_method: string }>(
    `SELECT active_method
       FROM ims_inventory_cost_state
      WHERE business_id = ?
      LIMIT 1`,
    [businessId],
  );
  if (costingRows[0]?.active_method === 'fifo') {
    throw new FifoCostingConflict(CIN7_FIFO_STOCK_GUARD_MESSAGE);
  }
  const rows = await imsQuery<{ has_build_movements: number }>(
    `SELECT EXISTS(
       SELECT 1 FROM ims_stock_movements
        WHERE business_id = ?
          AND movement_type IN ('build_component_consumed','build_output_produced','build_component_restored','build_output_reversed')
     ) AS has_build_movements`,
    [businessId],
  );
  if (Number(rows[0]?.has_build_movements ?? 0) === 1) throw new Error(CIN7_BUILD_STOCK_GUARD_MESSAGE);
}