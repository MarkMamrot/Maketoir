export interface WholesaleReorderLine {
  variant_id: string;
  qty_ordered: number;
}

interface WholesaleReorderVariant {
  variant_id: string;
  product_id: string;
  sku: string | null;
  option1_value: string | null;
  option2_value: string | null;
  option3_value: string | null;
  price_wholesale: number;
  available: number;
}

interface WholesaleReorderProduct {
  product_id: string;
  name: string;
  allow_indent_wholesale: number;
  variants: WholesaleReorderVariant[];
}

export interface WholesaleReorderCartItem {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_label: string;
  sku: string | null;
  qty: number;
  unit_price: number;
  available: number;
  allow_indent: boolean;
  is_indent: boolean;
  indent_qty: number;
}

export interface WholesaleReorderResult {
  items: WholesaleReorderCartItem[];
  adjustedLines: number;
  unavailableLines: number;
}

function variantLabel(variant: WholesaleReorderVariant) {
  return [variant.option1_value, variant.option2_value, variant.option3_value].filter(Boolean).join(' / ') || 'Default';
}

export function buildWholesaleReorderCart(
  orderLines: WholesaleReorderLine[],
  products: WholesaleReorderProduct[],
): WholesaleReorderResult {
  const liveVariants = new Map<string, { product: WholesaleReorderProduct; variant: WholesaleReorderVariant }>();
  for (const product of products) {
    for (const variant of product.variants ?? []) liveVariants.set(variant.variant_id, { product, variant });
  }

  let adjustedLines = 0;
  let unavailableLines = 0;
  const items = orderLines.flatMap<WholesaleReorderCartItem>(line => {
    const live = liveVariants.get(line.variant_id);
    if (!live) {
      unavailableLines += 1;
      return [];
    }

    const allowIndent = !!live.product.allow_indent_wholesale;
    const requestedQty = Number(line.qty_ordered);
    const quantity = allowIndent ? requestedQty : Math.min(requestedQty, Number(live.variant.available));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      unavailableLines += 1;
      return [];
    }
    if (quantity < requestedQty) adjustedLines += 1;
    const indentQty = Math.max(0, quantity - Number(live.variant.available));
    return [{
      variant_id: live.variant.variant_id,
      product_id: live.product.product_id,
      product_name: live.product.name,
      variant_label: variantLabel(live.variant),
      sku: live.variant.sku,
      qty: quantity,
      unit_price: Number(live.variant.price_wholesale),
      available: Number(live.variant.available),
      allow_indent: allowIndent,
      is_indent: indentQty > 0,
      indent_qty: indentQty,
    }];
  });

  return { items, adjustedLines, unavailableLines };
}