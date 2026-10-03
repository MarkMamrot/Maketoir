import { createHash } from 'crypto';
import { getIMSPool } from '@/services/IMSMySQLService';
import { loadStockAllocationSuggestions } from './suggestionService';

export async function notifyStockAllocationSuggestionsForPurchaseOrder(input: {
  businessId: string;
  poId: number;
  poNumber?: string | null;
}): Promise<boolean> {
  const suggestions = (await loadStockAllocationSuggestions(input.businessId))
    .filter(row => row.poId === input.poId);
  if (suggestions.length === 0) return false;

  const signature = suggestions
    .map(row => `${row.soItemId}:${row.poItemId}:${row.quantity}`)
    .sort()
    .join('|');
  const dedupeKey = `po-allocation-suggestions:${input.poId}:${createHash('sha256').update(signature).digest('hex').slice(0, 20)}`;
  const dedupeNeedle = `"dedupe_key":"${dedupeKey}"`;
  const lockName = `notify:${createHash('sha256').update(`${input.businessId}:${dedupeKey}`).digest('hex').slice(0, 48)}`;
  const connection = await getIMSPool().getConnection();
  let lockAcquired = false;

  try {
    const [lockRows] = await connection.query<any[]>('SELECT GET_LOCK(?, 5) AS acquired', [lockName]);
    lockAcquired = Number(lockRows[0]?.acquired) === 1;
    if (!lockAcquired) return false;
    const [existing] = await connection.query<any[]>(
      `SELECT id
         FROM ims_notifications
        WHERE business_id = ? AND source = 'stock_allocation'
          AND detail LIKE ?
        ORDER BY id DESC LIMIT 1`,
      [input.businessId, `%${dedupeNeedle}%`],
    );
    if (existing.length > 0) return false;

    const salesOrderCount = new Set(suggestions.map(row => row.soId)).size;
    const suggestedQuantity = Number(suggestions.reduce((sum, row) => sum + row.quantity, 0).toFixed(4));
    const poLabel = input.poNumber?.trim() || `PO ${input.poId}`;
    await connection.execute(
      `INSERT INTO ims_notifications (business_id, type, source, title, message, detail)
       VALUES (?, 'warning', 'stock_allocation', ?, ?, ?)`,
      [
        input.businessId,
        'Incoming supply can cover waiting orders',
        `${poLabel} has ${suggestedQuantity} free incoming ${suggestedQuantity === 1 ? 'unit' : 'units'} suggested across ${salesOrderCount} waiting ${salesOrderCount === 1 ? 'Sales Order' : 'Sales Orders'}. Review the ranked suggestions before allocating.`,
        JSON.stringify({
          action: 'open_stock_allocation',
          po_id: input.poId,
          suggestion_count: suggestions.length,
          sales_order_count: salesOrderCount,
          suggested_quantity: suggestedQuantity,
          dedupe_key: dedupeKey,
        }),
      ],
    );
    return true;
  } finally {
    if (lockAcquired) {
      await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    }
    connection.release();
  }
}