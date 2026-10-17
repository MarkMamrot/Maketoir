import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { lockInventoryCostState } from '@/lib/ims/costing/fifoCostingService';
import { syncCNXeroWithOutcome, triggerCNXeroSync, type CNXeroSyncOutcome } from '@/lib/ims/xeroHooks';
import { calculateShopifyRefundEligibleSpend } from '@/lib/loyalty/calculations';
import { ShopifyLoyaltyService } from '@/lib/loyalty/ShopifyLoyaltyService';
import { ShopifyLoyaltyMetafieldService } from '@/lib/loyalty/ShopifyLoyaltyMetafieldService';
import { parseShopifyRefund } from '@/lib/shopifyRefund';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export type ShopifyOrderRefundResult = {
  outcome: 'refunded' | 'duplicate';
  salesOrderId: number;
  creditNoteId: number | null;
};

export type ShopifyOrderRefundInput = {
  businessId: string;
  channelInstanceId: string;
  refund: Record<string, unknown>;
};

export async function applyShopifyOrderRefund(input: ShopifyOrderRefundInput): Promise<ShopifyOrderRefundResult> {
  const result = await processShopifyOrderRefund(input, false);
  return { outcome: result.outcome, salesOrderId: result.salesOrderId, creditNoteId: result.creditNoteId };
}

// The recovery worker must retain blocked/queued accounting as unfinished work.
export async function recoverShopifyOrderRefund(input: ShopifyOrderRefundInput): Promise<
  ShopifyOrderRefundResult & { accounting: CNXeroSyncOutcome }
> {
  const result = await processShopifyOrderRefund(input, true);
  if (!result.accounting) throw new Error('Shopify refund recovery has no accounting outcome.');
  return { ...result, accounting: result.accounting };
}

// Local CN, stock and financial status only; loyalty and provider calls belong after commit.
export async function applyShopifyOrderRefundInTransaction(
  connection: PoolConnection,
  input: ShopifyOrderRefundInput,
): Promise<ShopifyOrderRefundResult> {
  // Preserve stock-owner lock order when verifying an already completed CN.
  await lockInventoryCostState(connection, input.businessId);
  const { result, order } = await prepareLocalShopifyRefund(input, true, connection);
  await updateRefundFinancialStatus(input, order.id, connection);
  return { outcome: result.processed ? 'refunded' : 'duplicate', salesOrderId: order.id, creditNoteId: result.creditNoteId };
}

async function prepareLocalShopifyRefund(input: ShopifyOrderRefundInput, recovery: boolean, connection?: PoolConnection) {
  const query = async <T>(sql: string, values: Array<string | number>): Promise<T[]> => {
    if (!connection) return imsQuery<T>(sql, values);
    const [rows] = await connection.execute<(T & RowDataPacket)[]>(sql, values);
    return rows;
  };
  const externalOrderId = String(input.refund.order_id ?? '').trim();
  if (!/^\d+$/.test(externalOrderId)) throw new Error('Shopify refund order ID is invalid.');
  const orders = await query<{ id: number; payment_gateway: string | null }>(
    `SELECT id, payment_gateway FROM ims_sales_orders
      WHERE business_id = ? AND sales_channel = 'shopify'
        AND channel_instance_id = ? AND external_order_id = ? LIMIT 1${connection ? ' FOR UPDATE' : ''}`,
    [input.businessId, input.channelInstanceId, externalOrderId],
  );
  const order = orders[0];
  if (!order) throw new Error(`Shopify order ${externalOrderId} is not available for exact-instance refund.`);
  const refund = parseShopifyRefund(input.refund, order.payment_gateway);
  if (!/^\d+$/.test(refund.shopifyRefundId)) throw new Error('Shopify refund ID is invalid.');
  const returnPayload = input.refund.return;
  const returnId = returnPayload && typeof returnPayload === 'object' && 'id' in returnPayload
    ? returnPayload.id : null;
  const refundLines = input.refund.refund_line_items ?? [];
  if (!Array.isArray(refundLines)) throw new Error('Shopify refund line items are invalid.');

  const readCompletedNote = () => query<{
    id: number; total_amount: number | string; tax_amount: number | string;
  }>(
    `SELECT id, total_amount, tax_amount FROM ims_credit_notes
      WHERE business_id = ? AND so_id = ? AND source = 'shopify' AND status = 'complete'
        AND ((channel_instance_id = ? AND external_refund_id = ?)
          OR (channel_instance_id IS NULL AND shopify_refund_id = ?)) LIMIT 1${connection ? ' FOR UPDATE' : ''}`,
    [input.businessId, order.id, input.channelInstanceId, refund.shopifyRefundId, refund.shopifyRefundId],
  );
  const priorNotes = recovery ? await readCompletedNote() : [];
  const refundOptions = {
    soId: order.id,
    channelInstanceId: input.channelInstanceId,
    shopifyRefundId: refund.shopifyRefundId,
    shopifyReturnId: returnId ? String(returnId) : null,
    gateway: refund.gateway,
    amount: refund.amount,
    taxAmount: refund.taxAmount,
    note: 'Shopify refund via refunds/create',
    restockLines: refund.restockLines,
  };
  const result = priorNotes[0]
    ? { processed: false, creditNoteId: Number(priorNotes[0].id) }
    : connection
      ? await ImsSORepo.processShopifyRefundInTransaction(connection, input.businessId, refundOptions)
      : await ImsSORepo.processShopifyRefund(input.businessId, refundOptions);
  if (recovery && (!Number.isSafeInteger(result.creditNoteId) || Number(result.creditNoteId) <= 0)) {
    throw new Error('Shopify refund recovery could not verify a local credit note.');
  }
  if (recovery) {
    const notes = priorNotes.length ? priorNotes : await readCompletedNote();
    const note = notes[0];
    if (!note || Number(note.id) !== result.creditNoteId
      || Math.round(Number(note.total_amount) * 100) !== Math.round(refund.amount * 100)
      || Math.round(Number(note.tax_amount) * 100) !== Math.round(refund.taxAmount * 100)) {
      throw new Error('Shopify refund recovery found an incomplete, unowned or changed credit note.');
    }
  }
  return { result, order, externalOrderId, refund, refundLines };
}

async function processShopifyOrderRefund(input: ShopifyOrderRefundInput, recovery: boolean): Promise<
  ShopifyOrderRefundResult & { accounting: CNXeroSyncOutcome | null }
> {
  const { result, order, externalOrderId, refund, refundLines } = await prepareLocalShopifyRefund(input, recovery);
  if (!result.processed && !recovery) {
    return { outcome: 'duplicate', salesOrderId: order.id, creditNoteId: result.creditNoteId, accounting: null };
  }
  const eligibleRefundSpend = calculateShopifyRefundEligibleSpend({
    refundLineItems: refundLines.map((item: Record<string, unknown> | null) => ({
      subtotal: Number(item?.subtotal ?? 0),
      totalTax: Number(item?.total_tax ?? 0),
      giftCard: Boolean(item?.line_item && typeof item.line_item === 'object'
        && 'gift_card' in item.line_item && item.line_item.gift_card),
    })),
  });
  const loyalty = await ShopifyLoyaltyService.reverseRefund({
    businessId: input.businessId,
    channelInstanceId: input.channelInstanceId,
    shopifyOrderId: externalOrderId,
    shopifyRefundId: refund.shopifyRefundId,
    eligibleRefundSpend,
    ...(recovery ? { deferMetafieldSync: true } : {}),
  });
  if (recovery && loyalty.status === 'reversed') {
    const accounts = await imsQuery<{ contact_id: number }>(
      `SELECT contact_id FROM loyalty_accounts WHERE business_id = ? AND id = ? LIMIT 1`,
      [input.businessId, loyalty.mutation.accountId],
    );
    const contactId = Number(accounts[0]?.contact_id);
    if (!Number.isSafeInteger(contactId) || contactId <= 0) {
      throw new Error('Shopify refund loyalty account is not available for this business.');
    }
    const projection = await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({
      businessId: input.businessId, channelInstanceId: input.channelInstanceId, contactId,
    });
    if (projection.status === 'failed') throw new Error('Shopify refund loyalty projection is unfinished.');
  }
  await updateRefundFinancialStatus(input, order.id);
  let accounting: CNXeroSyncOutcome | null = null;
  if (result.creditNoteId) {
    if (recovery) accounting = await syncCNXeroWithOutcome(input.businessId, result.creditNoteId);
    else await triggerCNXeroSync(input.businessId, result.creditNoteId);
  }
  return {
    outcome: result.processed ? 'refunded' : 'duplicate',
    salesOrderId: order.id, creditNoteId: result.creditNoteId, accounting,
  };
}

async function updateRefundFinancialStatus(input: ShopifyOrderRefundInput, orderId: number, connection?: PoolConnection) {
  const sql =
    `UPDATE ims_sales_orders SET financial_status = CASE
        WHEN refunded_amount >= total_amount THEN 'refunded'
        WHEN refunded_amount > 0 THEN 'partially_refunded'
        ELSE financial_status END
      WHERE id = ? AND business_id = ? AND channel_instance_id = ?`;
  const values = [orderId, input.businessId, input.channelInstanceId];
  if (connection) await connection.execute(sql, values);
  else await imsExecute(sql, values);
}