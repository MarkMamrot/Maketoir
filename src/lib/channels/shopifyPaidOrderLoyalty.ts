import { calculateShopifyEligibleSpend } from '@/lib/loyalty/calculations';
import { ShopifyLoyaltyService } from '@/lib/loyalty/ShopifyLoyaltyService';
import { getShopifyOrderCustomerId } from '@/lib/ims/shopifyOrderCustomer';
import { toBusinessDate } from '@/lib/shopifyDate';

export async function applyShopifyPaidOrderLoyalty(input: {
  businessId: string;
  channelInstanceId: string;
  order: Record<string, any>;
}): Promise<void> {
  const shopifyOrderId = String(input.order.id ?? '').trim();
  if (!/^\d+$/.test(shopifyOrderId)) throw new Error('Shopify order ID is invalid for loyalty processing.');
  const shopifyCustomerId = getShopifyOrderCustomerId(input.order);
  const discountCodes = Array.isArray(input.order.discount_codes)
    ? input.order.discount_codes.map((discount: any) => String(discount?.code ?? ''))
    : [];
  if (shopifyCustomerId && discountCodes.length > 0) {
    await ShopifyLoyaltyService.markPaidOrderRedemptionsUsed({
      businessId: input.businessId,
      channelInstanceId: input.channelInstanceId,
      shopifyOrderId,
      shopifyCustomerId,
      discountCodes,
    });
  }
  const eligibleSpend = calculateShopifyEligibleSpend({
    subtotalPrice: Number(input.order.subtotal_price ?? 0),
    lineItems: (Array.isArray(input.order.line_items) ? input.order.line_items : []).map((item: any) => ({
      quantity: Number(item.quantity ?? 0),
      price: item.price ?? 0,
      giftCard: Boolean(item.gift_card),
      discountAllocations: (Array.isArray(item.discount_allocations) ? item.discount_allocations : [])
        .map((allocation: any) => ({ amount: allocation?.amount ?? 0 })),
    })),
  });
  await ShopifyLoyaltyService.awardPaidOrder({
    businessId: input.businessId,
    channelInstanceId: input.channelInstanceId,
    shopifyOrderId,
    paidDate: toBusinessDate(input.order.processed_at ?? input.order.updated_at ?? input.order.created_at),
    eligibleSpend,
  });
}