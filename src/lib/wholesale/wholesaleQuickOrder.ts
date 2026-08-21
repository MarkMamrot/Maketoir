export interface WholesaleQuickOrderVariant {
  variant_id: string;
  product_id: string;
  sku: string | null;
  barcode: string | null;
  option1_value: string | null;
  option2_value: string | null;
  option3_value: string | null;
  price_wholesale: number;
  available: number;
}

export interface WholesaleQuickOrderProduct {
  product_id: string;
  name: string;
  allow_indent_wholesale: number;
  variants: WholesaleQuickOrderVariant[];
}

export interface WholesaleQuickOrderItem {
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

export interface WholesaleQuickOrderIssue {
  line: number;
  identifier: string;
  reason: string;
}

export interface WholesaleQuickOrderResult {
  items: WholesaleQuickOrderItem[];
  issues: WholesaleQuickOrderIssue[];
  adjustedLines: number;
}

interface ParsedLine {
  line: number;
  identifier: string;
  quantity: number;
}

function parseLine(value: string, line: number): ParsedLine | WholesaleQuickOrderIssue | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.includes(',') || trimmed.includes('\t') || trimmed.includes(';')
    ? trimmed.split(/[\t,;]+/).map(part => part.trim()).filter(Boolean)
    : trimmed.split(/\s+/);
  const identifier = parts[0] ?? '';
  if (line === 1 && /^(sku|barcode|item)$/i.test(identifier) && /^(qty|quantity)$/i.test(parts[1] ?? '')) return null;
  const quantity = Number(parts[1]);
  if (!identifier || parts.length !== 2 || !Number.isInteger(quantity) || quantity <= 0) {
    return { line, identifier: identifier || trimmed, reason: 'Use SKU or barcode followed by a whole quantity.' };
  }
  return { line, identifier, quantity };
}

function variantLabel(variant: WholesaleQuickOrderVariant) {
  return [variant.option1_value, variant.option2_value, variant.option3_value].filter(Boolean).join(' / ') || 'Default';
}

export function buildWholesaleQuickOrder(
  input: string,
  products: WholesaleQuickOrderProduct[],
  existingQuantities: Record<string, number> = {},
): WholesaleQuickOrderResult {
  const issues: WholesaleQuickOrderIssue[] = [];
  const parsed: ParsedLine[] = [];
  input.split(/\r?\n/).forEach((value, index) => {
    const result = parseLine(value, index + 1);
    if (!result) return;
    if ('reason' in result) issues.push(result);
    else parsed.push(result);
  });

  const identifierIndex = new Map<string, Array<{ product: WholesaleQuickOrderProduct; variant: WholesaleQuickOrderVariant }>>();
  for (const product of products) {
    for (const variant of product.variants ?? []) {
      const identifiers = new Set([variant.sku, variant.barcode].map(identifier => String(identifier ?? '').trim().toLowerCase()).filter(Boolean));
      for (const key of identifiers) {
        identifierIndex.set(key, [...(identifierIndex.get(key) ?? []), { product, variant }]);
      }
    }
  }

  const requestedByVariant = new Map<string, { line: number; identifier: string; quantity: number; product: WholesaleQuickOrderProduct; variant: WholesaleQuickOrderVariant }>();
  for (const line of parsed) {
    const matches = identifierIndex.get(line.identifier.toLowerCase()) ?? [];
    if (matches.length === 0) {
      issues.push({ line: line.line, identifier: line.identifier, reason: 'Not found in your approved catalogue.' });
      continue;
    }
    if (matches.length > 1) {
      issues.push({ line: line.line, identifier: line.identifier, reason: 'Matches more than one approved variant.' });
      continue;
    }
    const match = matches[0];
    const existing = requestedByVariant.get(match.variant.variant_id);
    requestedByVariant.set(match.variant.variant_id, {
      line: existing?.line ?? line.line,
      identifier: existing?.identifier ?? line.identifier,
      quantity: (existing?.quantity ?? 0) + line.quantity,
      ...match,
    });
  }

  let adjustedLines = 0;
  const items: WholesaleQuickOrderItem[] = [];
  for (const request of requestedByVariant.values()) {
    const allowIndent = !!request.product.allow_indent_wholesale;
    const alreadyInCart = Number(existingQuantities[request.variant.variant_id] ?? 0);
    const remainingStock = Math.max(0, Number(request.variant.available) - alreadyInCart);
    const quantity = allowIndent ? request.quantity : Math.min(request.quantity, remainingStock);
    if (quantity <= 0) {
      issues.push({ line: request.line, identifier: request.identifier, reason: 'No additional stock is available.' });
      continue;
    }
    if (quantity < request.quantity) adjustedLines += 1;
    const finalQuantity = alreadyInCart + quantity;
    const indentQty = Math.max(0, finalQuantity - Number(request.variant.available));
    items.push({
      variant_id: request.variant.variant_id,
      product_id: request.product.product_id,
      product_name: request.product.name,
      variant_label: variantLabel(request.variant),
      sku: request.variant.sku,
      qty: quantity,
      unit_price: Number(request.variant.price_wholesale),
      available: Number(request.variant.available),
      allow_indent: allowIndent,
      is_indent: indentQty > 0,
      indent_qty: indentQty,
    });
  }

  return { items, issues: issues.sort((left, right) => left.line - right.line), adjustedLines };
}