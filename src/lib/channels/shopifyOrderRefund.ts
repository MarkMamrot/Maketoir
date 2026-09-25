import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { triggerCNXeroSync } from '@/lib/ims/xeroHooks';
import { calculateShopifyRefundEligibleSpend } from '@/lib/loyalty/calculations';
import { ShopifyLoyaltyService } from '@/lib/loyalty/ShopifyLoyaltyService';
import { parseShopifyRefund } from '@/lib/shopifyRefund';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export type ShopifyOrderRefundResult = {
  outcome: 'refunded' | 'duplicate';
  salesOrderId: number;
  creditNoteId: number | null;
};

export async function applyShopifyOrderRefund(input: {
  businessId: string;
  channelInstanceId: string;
  refund: Record<string, any>;
}): Promise<ShopifyOrderRefundResult> {
  const externalOrderId = String(input.refund.order_id ?? '').trim();
  if (!/^\d+$/.test(externalOrderId)) throw new Error('Shopify refund order ID is invalid.');
  const orders = await imsQuery<{ id: number; payment_gateway: string | null }>(
    `SELECT id, payment_gateway FROM ims_sales_orders
      WHERE business_id = ? AND sales_channel = 'shopify'
        AND channel_instance_id = ? AND external_order_id = ? LIMIT 1`,
    [input.businessId, input.channelInstanceId, externalOrderId],
  );
  const order = orders[0];
  if (!order) throw new Error(`Shopify order ${externalOrderId} is not available for exact-instance refund.`);
  const refund = parseShopifyRefund(input.refund, order.payment_gateway);
  if (!/^\d+$/.test(refund.shopifyRefundId)) throw new Error('Shopify refund ID is invalid.');

  const result = await ImsSORepo.processShopifyRefund(input.businessId, {
    soId: order.id,
    channelInstanceId: input.channelInstanceId,
    shopifyRefundId: refund.shopifyRefundId,
    shopifyReturnId: input.refund.return?.id ? String(input.refund.return.id) : null,
    gateway: refund.gateway,
    amount: refund.amount,
    taxAmount: refund.taxAmount,
    note: 'Shopify refund via refunds/create',
    restockLines: refund.restockLines,
  });
  if (!result.processed) {
    return { outcome: 'duplicate', salesOrderId: order.id, creditNoteId: result.creditNoteId };
  }

  const eligibleRefundSpend = calculateShopifyRefundEligibleSpend({
    refundLineItems: (input.refund.refund_line_items ?? []).map((item: any) => ({
      subtotal: item?.subtotal ?? 0,
      totalTax: item?.total_tax ?? 0,
      giftCard: Boolean(item?.line_item?.gift_card),
    })),
  });
  await ShopifyLoyaltyService.reverseRefund({
    businessId: input.businessId,
    channelInstanceId: input.channelInstanceId,
    shopifyOrderId: externalOrderId,
    shopifyRefundId: refund.shopifyRefundId,
    eligibleRefundSpend,
  });
  await imsExecute(
    `UPDATE ims_sales_orders SET financial_status = CASE
        WHEN refunded_amount >= total_amount THEN 'refunded'
        WHEN refunded_amount > 0 THEN 'partially_refunded'
        ELSE financial_status END
      WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
    [order.id, input.businessId, input.channelInstanceId],
  );
  if (result.creditNoteId) await triggerCNXeroSync(input.businessId, result.creditNoteId);
  return { outcome: 'refunded', salesOrderId: order.id, creditNoteId: result.creditNoteId };
}