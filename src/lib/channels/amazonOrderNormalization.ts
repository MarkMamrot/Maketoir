import type { AmazonOrder, AmazonOrderItem, AmazonOrderAddress } from './amazonSpApi';

function amount(value: { Amount?: string } | undefined): number {
  const parsed = Number(value?.Amount ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface NormalizedAmazonOrderLine {
  externalOrderItemId: string;
  sellerSku: string;
  title: string;
  quantityOrdered: number;
  quantityShipped: number;
  unitPrice: number;
  lineTotal: number;
  taxRate: number;
}

export interface NormalizedAmazonOrder {
  amazonOrderId: string;
  purchasedAt: string;
  lastUpdatedAt: string;
  status: string;
  currencyCode: string;
  subtotal: number;
  taxAmount: number;
  freight: number;
  totalAmount: number;
  paymentGateway: string;
  shippingMethod: string | null;
  address: AmazonOrderAddress;
  lines: NormalizedAmazonOrderLine[];
}

export function normalizeAmazonOrder(order: AmazonOrder, items: AmazonOrderItem[]): NormalizedAmazonOrder {
  const amazonOrderId = String(order.AmazonOrderId ?? '').trim();
  if (!amazonOrderId) throw new Error('Amazon order ID is missing.');
  if (order.FulfillmentChannel !== 'MFN') throw new Error('Only seller-fulfilled Amazon orders can be imported.');
  const currencyCode = String(order.OrderTotal?.CurrencyCode ?? 'AUD').trim().toUpperCase();
  if (currencyCode !== 'AUD') throw new Error(`Amazon order ${amazonOrderId} is not in AUD.`);

  let itemTax = 0;
  let freight = 0;
  const lines = items.map(item => {
    const quantityOrdered = Math.max(0, Math.floor(Number(item.QuantityOrdered ?? 0)));
    const externalOrderItemId = String(item.OrderItemId ?? '').trim();
    if (!externalOrderItemId || quantityOrdered <= 0) {
      throw new Error(`Amazon order ${amazonOrderId} contains an invalid order item.`);
    }
    const principal = amount(item.ItemPrice);
    const tax = amount(item.ItemTax);
    const promotion = amount(item.PromotionDiscount);
    const promotionTax = amount(item.PromotionDiscountTax);
    const shipping = amount(item.ShippingPrice);
    const shippingTax = amount(item.ShippingTax);
    const shippingDiscount = amount(item.ShippingDiscount);
    const shippingDiscountTax = amount(item.ShippingDiscountTax);
    const lineTotal = money(Math.max(0, principal + tax - promotion - promotionTax));
    itemTax += tax - promotionTax;
    freight += shipping + shippingTax - shippingDiscount - shippingDiscountTax;
    return {
      externalOrderItemId,
      sellerSku: String(item.SellerSKU ?? '').trim(),
      title: String(item.Title ?? item.ASIN ?? '').trim(),
      quantityOrdered,
      quantityShipped: Math.max(0, Math.min(quantityOrdered, Math.floor(Number(item.QuantityShipped ?? 0)))),
      unitPrice: money(lineTotal / quantityOrdered),
      lineTotal,
      taxRate: tax > 0 ? 0.1 : 0,
    };
  });
  if (lines.length === 0) throw new Error(`Amazon order ${amazonOrderId} has no order items.`);

  const totalAmount = money(amount(order.OrderTotal));
  // IMS freight is stored tax-inclusive and added after merchandise subtotal/tax.
  const taxAmount = money(Math.max(0, itemTax));
  freight = money(Math.max(0, freight));
  return {
    amazonOrderId,
    purchasedAt: String(order.PurchaseDate ?? ''),
    lastUpdatedAt: String(order.LastUpdateDate ?? ''),
    status: String(order.OrderStatus ?? ''),
    currencyCode,
    subtotal: money(Math.max(0, totalAmount - taxAmount - freight)),
    taxAmount,
    freight,
    totalAmount,
    paymentGateway: ['Amazon', ...(order.PaymentMethodDetails ?? [])].join(' - ').slice(0, 255),
    shippingMethod: String(order.ShipmentServiceLevelCategory ?? '').trim() || null,
    address: order.ShippingAddress ?? {},
    lines,
  };
}