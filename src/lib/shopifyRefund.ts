/**
 * Parse a Shopify refund object (from the `refunds/create` webhook or from
 * `order.refunds[]`) into the normalised shape consumed by
 * ImsSORepo.processShopifyRefund().
 *
 * Restock semantics: Shopify `restock_type` of 'return', 'cancel' or
 * 'legacy_restock' means the item went back into sellable stock; 'no_restock'
 * is money-only (e.g. damaged goods refunded but discarded).
 */
export interface NormalisedRefund {
  shopifyRefundId: string;
  amount: number;      // total money refunded (incl. tax)
  taxAmount: number;
  gateway: string | null;
  restockLines: {
    shopifyVariantId: string;
    quantity: number;
    restock: boolean;
    unitPrice: number;   // ex-tax unit price
    taxAmount: number;   // GST for this refund line (total, not per unit)
    name?: string | null;
    sku?: string | null;
  }[];
}

const RESTOCK_TYPES = new Set(['return', 'cancel', 'legacy_restock']);

export function parseShopifyRefund(refund: any, fallbackGateway?: string | null): NormalisedRefund {
  const txns: any[] = Array.isArray(refund?.transactions) ? refund.transactions : [];
  const refundTxns = txns.filter(t =>
    String(t?.kind) === 'refund' && (t?.status == null || String(t.status) === 'success'),
  );
  const amount = refundTxns.reduce((s, t) => s + parseFloat(t?.amount ?? '0'), 0);

  const rlis: any[] = Array.isArray(refund?.refund_line_items) ? refund.refund_line_items : [];
  const taxAmount = rlis.reduce((s, r) => s + parseFloat(r?.total_tax ?? '0'), 0);

  const gateway = refundTxns[0]?.gateway ?? fallbackGateway ?? null;

  const restockLines = rlis
    .map(r => {
      const qty = Number(r?.quantity ?? 0);
      const lineTax = parseFloat(r?.total_tax ?? '0');
      // subtotal is the ex-tax amount refunded for this line (Shopify sends it ex-tax).
      const subtotal = parseFloat(r?.subtotal ?? '0');
      const unitPrice = qty > 0 ? subtotal / qty : parseFloat(r?.line_item?.price ?? '0');
      return {
        shopifyVariantId: String(r?.line_item?.variant_id ?? ''),
        quantity: qty,
        restock: RESTOCK_TYPES.has(String(r?.restock_type ?? 'no_restock')),
        unitPrice: Math.round(unitPrice * 10000) / 10000,
        taxAmount: Math.round(lineTax * 100) / 100,
        name: r?.line_item?.title ?? r?.line_item?.name ?? null,
        sku: r?.line_item?.sku ?? null,
      };
    })
    .filter(l => l.shopifyVariantId && l.quantity > 0);

  return {
    shopifyRefundId: String(refund?.id ?? ''),
    amount: Math.round(amount * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    gateway: gateway ? String(gateway) : null,
    restockLines,
  };
}
