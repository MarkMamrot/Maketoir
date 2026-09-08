import { imsQuery } from '@/services/IMSMySQLService';

export const CIN7_BUILD_STOCK_GUARD_MESSAGE = 'Cin7 stock replacement is blocked because completed product builds exist. Reconcile differences with Stocktakes or audited stock adjustments so build history and stock on hand remain aligned.';

export async function assertCin7StockOverwriteAllowed(businessId: string): Promise<void> {
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