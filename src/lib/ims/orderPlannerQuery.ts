import { imsQuery } from '@/services/IMSMySQLService';
import { IMS_SALES_LINES_SQL } from './salesLinesQuery';

export async function getOrderPlannerBranchSales(branchIds: string[], windowDays: number, now = Date.now()) {
  const selected = [...new Set(branchIds)];
  if (selected.length === 0) throw new Error('Select at least one sales branch.');
  const from = new Date(now - windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(now).toISOString().slice(0, 10);
  const rows = await imsQuery<{ variant_id: string; sales_qty: number | string }>(
    `SELECT s.variant_id, SUM(s.qty) AS sales_qty
       FROM (${IMS_SALES_LINES_SQL}) s
      WHERE s.location_id IN (${selected.map(() => '?').join(',')}) AND s.variant_id IS NOT NULL
      GROUP BY s.variant_id`,
    [from, to, from, to, from, to, ...selected],
  );
  return new Map(rows.map(row => [row.variant_id, Number(row.sales_qty)]));
}
