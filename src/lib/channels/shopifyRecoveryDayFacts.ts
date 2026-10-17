import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

export function shopifyAccountingFactsHash(
  order: Record<string, unknown>, lines: Record<string, unknown>[],
): string {
  const number = (value: unknown) => {
    const result = Number(value ?? 0);
    if (!Number.isFinite(result)) throw new Error('Invalid persisted online accounting amount.');
    return result;
  };
  const canonical = {
    date: order.business_date, cancelled: order.status === 'cancelled',
    totals: ['subtotal', 'tax_amount', 'total_amount', 'freight', 'discount', 'gift_card_amount'].map(key => number(order[key])),
    currency: order.currency_code, gateway: order.payment_gateway,
    lines: lines.map(line => ({
      externalId: String(line.external_order_item_id ?? ''),
      variant: String(line.variant_id),
      values: ['qty_ordered', 'unit_price', 'discount_pct', 'tax_rate', 'line_total'].map(key => number(line[key])),
    })).sort((left, right) => left.externalId.localeCompare(right.externalId) || left.variant.localeCompare(right.variant)),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export async function readShopifyAccountingFacts(
  connection: PoolConnection,
  owner: { businessId: string; channelInstanceId: string; externalOrderId: string },
): Promise<{ businessDate: string; hash: string } | null> {
  const [[order]] = await connection.execute<RowDataPacket[]>(
    `SELECT id, DATE_FORMAT(order_date,'%Y-%m-%d') AS business_date, status, subtotal,
       tax_amount,total_amount,freight,discount,gift_card_amount,currency_code,payment_gateway
      FROM ims_sales_orders WHERE business_id = ? AND channel_instance_id = ? AND external_order_id = ? FOR UPDATE`,
    [owner.businessId, owner.channelInstanceId, owner.externalOrderId],
  );
  if (!order) return null;
  const [lines] = await connection.execute<RowDataPacket[]>(
    `SELECT external_order_item_id,variant_id,qty_ordered,unit_price,discount_pct,tax_rate,line_total
       FROM ims_sales_order_items WHERE business_id = ? AND so_id = ?`,
    [owner.businessId, order.id],
  );
  return { businessDate: String(order.business_date), hash: shopifyAccountingFactsHash(order, lines) };
}

export async function markOnlineDayChanged(
  connection: PoolConnection,
  owner: { businessId: string; channelInstanceId: string },
  businessDate: string,
  reviewReason: string | null = null,
): Promise<void> {
  await connection.execute(
    `INSERT INTO ims_online_day_changes
      (business_id,channel_instance_id,business_date,generation,review_reason)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE generation = VALUES(generation),
       review_reason = COALESCE(review_reason,VALUES(review_reason))`,
    [owner.businessId, owner.channelInstanceId, businessDate, randomUUID(), reviewReason],
  );
}
