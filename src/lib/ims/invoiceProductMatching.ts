export type InvoiceMatchVariant = {
  variant_id: string;
  sku?: string | null;
  barcode?: string | null;
  product_name?: string | null;
  variant_label?: string | null;
  product_brand?: string | null;
  cost_aud?: number | null;
  cost_foreign?: string | null;
  supplier_contact_id?: number | null;
};

type InvoiceMatchLine = { product_code?: string | null; barcode?: string | null; product_name?: string | null; unit_price?: number | null; qty?: number | null; line_total?: number | null; discount_pct?: number | null; discount_amount?: number | null; tax_rate?: number | null };

function comparable(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizedCode(value: string | null | undefined): string {
  return comparable(value).normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, '');
}

function normalizedName(value: string | null | undefined): string {
  return comparable(value).replace(/[^a-z0-9]/g, '');
}

export function createInvoiceVariantMatcher(variants: InvoiceMatchVariant[]) {
  const skuIndex = new Map<string, InvoiceMatchVariant[]>();
  const barcodeIndex = new Map<string, InvoiceMatchVariant[]>();
  const normalizedSkuIndex = new Map<string, InvoiceMatchVariant[]>();
  for (const variant of variants) {
    for (const [index, key] of [[skuIndex, comparable(variant.sku)], [barcodeIndex, comparable(variant.barcode)], [normalizedSkuIndex, normalizedCode(variant.sku)]] as const) {
      if (key) index.set(key, [...(index.get(key) ?? []), variant]);
    }
  }
  return (line: InvoiceMatchLine) => {
    const code = comparable(line.product_code);
    const barcode = comparable(line.barcode);
    const skuMatches = skuIndex.get(code) ?? [];
    const barcodeMatches = [...new Map([...(barcodeIndex.get(code) ?? []), ...(barcodeIndex.get(barcode) ?? [])].map(variant => [variant.variant_id, variant])).values()];
    if (skuMatches.length || barcodeMatches.length) {
      const candidates = skuMatches.length && barcodeMatches.length
        ? skuMatches.filter(variant => barcodeMatches.some(candidate => candidate.variant_id === variant.variant_id))
        : skuMatches.length ? skuMatches : barcodeMatches;
      if (candidates.length !== 1) return null;
      return { ...candidates[0], confidence: skuMatches.length ? 'exact_sku' : 'exact_barcode', method: skuMatches.length ? 'SKU' : 'barcode' };
    }
    const normalizedMatches = normalizedSkuIndex.get(normalizedCode(line.product_code)) ?? [];
    if (normalizedMatches.length) {
      return normalizedMatches.length === 1 ? { ...normalizedMatches[0], confidence: 'normalized_sku', method: 'normalized SKU' } : null;
    }
    const name = normalizedName(line.product_name);
    if (name.length < 4) return null;
    const matches = variants.filter(variant => {
      const candidate = normalizedName(`${variant.product_name ?? ''} ${variant.variant_label ?? ''}`);
      return candidate.length >= 4 && (candidate.includes(name) || name.includes(candidate));
    });
    return matches.length === 1 ? { ...matches[0], confidence: 'fuzzy_name', method: 'name' } : null;
  };
}

export function invoiceMatchNeedsReview(confidence: string | null | undefined): boolean {
  return !['exact_sku', 'exact_barcode', 'manual'].includes(confidence ?? '');
}

export function assessInvoiceMatchEvidence(input: {
  confidence?: string | null;
  supplierExact: boolean;
  supplierId?: number | null;
  variant: InvoiceMatchVariant | null;
  line: { unit_price?: number | null; qty?: number | null; line_total?: number | null; discount_pct?: number | null; discount_amount?: number | null; tax_rate?: number | null };
  currency?: string | null;
  taxTreatment?: string | null;
}) {
  const supplierMatches = input.supplierExact && !!input.supplierId
    && Number(input.variant?.supplier_contact_id) === Number(input.supplierId);
  const reasons: string[] = [];
  if (!supplierMatches) reasons.push('Supplier is missing, inferred, or differs from the product supplier.');
  if (invoiceMatchNeedsReview(input.confidence)) reasons.push('Product code is not an exact match.');
  const currency = input.currency?.trim().toUpperCase();
  let storedCost: number | null = null;
  if (currency === 'AUD') storedCost = input.variant?.cost_aud == null ? null : Number(input.variant.cost_aud);
  else if (currency && input.variant?.cost_foreign) {
    try {
      const costs = JSON.parse(input.variant.cost_foreign);
      if (costs[currency] != null) storedCost = Number(costs[currency]);
    } catch { storedCost = null; }
  }
  const taxKnown = ['inc_tax', 'ex_tax', 'no_tax'].includes(input.taxTreatment ?? '');
  const taxRate = Number(input.line.tax_rate);
  const taxDivisor = input.taxTreatment === 'inc_tax' ? 1 + taxRate : 1;
  const comparableTax = taxKnown && (input.taxTreatment !== 'inc_tax' || (input.line.tax_rate != null && Number.isFinite(taxRate) && taxRate >= 0));
  const unitPrice = input.line.unit_price == null ? NaN : Number(input.line.unit_price);
  const qty = Number(input.line.qty);
  const discounted = input.line.line_total != null && qty > 0 ? Number(input.line.line_total) / qty
    : input.line.discount_amount != null && qty > 0 ? unitPrice - Number(input.line.discount_amount) / qty
    : unitPrice * (1 - Number(input.line.discount_pct ?? 0) / 100);
  const undiscountedCost = comparableTax && Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice / taxDivisor : null;
  const discountedCost = comparableTax && Number.isFinite(discounted) && discounted >= 0 ? discounted / taxDivisor : null;
  const canCompare = !!currency && storedCost != null && Number.isFinite(storedCost) && storedCost > 0 && undiscountedCost != null && discountedCost != null;
  const undiscountedDifference = canCompare ? Math.abs(undiscountedCost! - storedCost!) / storedCost! : null;
  const discountedDifference = canCompare ? Math.abs(discountedCost! - storedCost!) / storedCost! : null;
  const costSupportsMatch = canCompare && Math.min(undiscountedDifference!, discountedDifference!) <= 0.05 + 1e-9;
  if (canCompare && !costSupportsMatch) reasons.push('Both invoice unit costs differ from stored Cost by more than 5%.');
  return {
    requiresReview: reasons.length > 0,
    reasons,
    costStatus: !canCompare ? 'not_comparable' as const : costSupportsMatch ? 'supports_match' as const : 'differs' as const,
    storedCost, undiscountedCost, discountedCost, undiscountedDifference, discountedDifference,
  };
}

export function collectInvoiceImportLines<Line, Match>(
  lines: Line[], skipped: ReadonlySet<number>, mapLine: (line: Line, originalIndex: number) => Match | null,
): Match[] {
  return lines.flatMap((line, originalIndex) => {
    if (skipped.has(originalIndex)) return [];
    const mapped = mapLine(line, originalIndex);
    return mapped == null ? [] : [mapped];
  });
}

export function selectInvoiceMatchCandidates(line: InvoiceMatchLine, variants: InvoiceMatchVariant[], limit = 20, costContext?: { currency?: string | null; taxTreatment?: string | null }): InvoiceMatchVariant[] {
  const code = normalizedCode(line.product_code);
  const words = new Set(comparable(line.product_name).split(/[^a-z0-9]+/).filter(word => word.length >= 2));
  return variants.map(variant => {
    const sku = normalizedCode(variant.sku);
    const candidateWords = new Set(comparable(`${variant.product_name ?? ''} ${variant.variant_label ?? ''}`).split(/[^a-z0-9]+/).filter(word => word.length >= 2));
    const commonWords = [...words].filter(word => candidateWords.has(word)).length;
    const codeScore = code.length >= 4 && sku.length >= 4 && (sku.includes(code) || code.includes(sku)) ? 10 : 0;
    const identityScore = codeScore + commonWords / Math.max(words.size, candidateWords.size, 1);
    const costEvidence = costContext ? assessInvoiceMatchEvidence({ confidence: 'ai_match', supplierExact: false, variant, line, ...costContext }) : null;
    const score = identityScore > 0 ? identityScore + (costEvidence?.costStatus === 'supports_match' ? 0.25 : 0) : 0;
    return { variant, score };
  }).filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.variant.variant_id.localeCompare(right.variant.variant_id))
    .slice(0, limit).map(candidate => candidate.variant);
}

export function validateInvoiceAiMatches(
  raw: unknown,
  lines: Array<{ index: number; candidates: InvoiceMatchVariant[] }>,
) {
  const entries = Array.isArray(raw) ? raw : [];
  return lines.map(line => {
    const returned = entries.filter(entry => entry && Number.isInteger(entry.invoice_index) && entry.invoice_index === line.index);
    const entry = returned.length === 1 ? returned[0] : null;
    const confidence = ['high', 'medium', 'low'].includes(entry?.confidence) ? entry.confidence as string : null;
    const variant = line.candidates.find(candidate => candidate.variant_id === entry?.variant_id);
    const accepted = variant && (confidence === 'high' || confidence === 'medium');
    return {
      invoice_index: line.index,
      variant_id: accepted ? variant.variant_id : null,
      confidence: accepted ? confidence : null,
      reason: typeof entry?.reason === 'string' ? entry.reason.slice(0, 300) : 'No unambiguous match returned; review this line.',
      variant: accepted ? variant : null,
    };
  });
}