import { invoiceUnitPriceToProductCost } from './invoiceImportParser';

export type BulkProductDocumentLine = {
  product_name: string;
  product_code: string;
  barcode: string;
  description: string;
  brand: string;
  supplier_name: string;
  product_type: string;
  category: string;
  tags: string;
  unit_cost: number | null;
  rrp: number | null;
  source_price: number | null;
};

export type BulkProductDocumentImport = {
  currency: string;
  prices_include_tax: 'inc_tax' | 'ex_tax' | 'no_tax' | 'unknown';
  source_price_column: string;
  supplier_name: string;
  products: BulkProductDocumentLine[];
};

export type BulkProductSourcePriceMapping = 'cost' | 'rrp' | 'ignore';
export type BulkProductPriceReviewReason = 'ambiguous_field' | 'cost_currency' | 'cost_tax' | 'rrp_currency';

export type BulkProductPriceReview = {
  extraction: BulkProductDocumentImport;
  suggestedMapping: BulkProductSourcePriceMapping | '';
  reason: BulkProductPriceReviewReason;
};

export function matchBulkProductSupplierId(
  supplierName: string,
  suppliers: Array<{ id: string | number; name: string }>,
): number | '' {
  const supplierKey = supplierName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!supplierKey) return '';
  const match = suppliers.find(supplier => supplier.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === supplierKey);
  const supplierId = Number(match?.id);
  return Number.isInteger(supplierId) && supplierId > 0 ? supplierId : '';
}

function text(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, maxLength);
}

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(typeof value === 'string' ? value.replace(/[$,\s]/g, '') : value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 10000) / 10000 : null;
}

export function normalizeBulkProductDocumentImport(raw: unknown): BulkProductDocumentImport {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const rawCurrency = text(source.currency, 7).toUpperCase();
  const currency = rawCurrency === 'UNKNOWN' || /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'UNKNOWN';
  const rawTaxTreatment = text(source.prices_include_tax, 20);
  const pricesIncludeTax = ['inc_tax', 'ex_tax', 'no_tax'].includes(rawTaxTreatment)
    ? rawTaxTreatment as BulkProductDocumentImport['prices_include_tax']
    : 'unknown';
  const sourcePriceColumn = text(source.source_price_column ?? source.ambiguous_price_column, 100);
  const supplierName = text(source.supplier_name ?? source.supplier, 255);
  const rows = Array.isArray(source.products) ? source.products : Array.isArray(source.line_items) ? source.line_items : [];
  const products: BulkProductDocumentLine[] = [];

  for (const candidate of rows.slice(0, 500)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const row = candidate as Record<string, unknown>;
    const lineType = text(row.line_type, 30).toLowerCase();
    if (lineType && lineType !== 'product') continue;
    const productName = text(row.product_name ?? row.name, 255);
    if (!productName) continue;
    const productCode = text(row.product_code ?? row.sku ?? row.code, 100);
    const barcode = text(row.barcode ?? row.ean ?? row.upc ?? row.gtin, 100);
    const sourceCost = money(row.unit_cost ?? row.cost ?? row.unit_price);
    const unitCost = sourceCost !== null && currency === 'AUD' && pricesIncludeTax !== 'unknown'
      ? invoiceUnitPriceToProductCost(sourceCost, pricesIncludeTax, Number(row.tax_rate ?? 0.1))
      : sourceCost;
    products.push({
      product_name: productName,
      product_code: productCode,
      barcode,
      description: text(row.description, 5000),
      brand: text(row.brand, 255),
      supplier_name: text(row.supplier_name ?? row.supplier, 255) || supplierName,
      product_type: text(row.product_type, 100),
      category: text(row.category, 100),
      tags: Array.isArray(row.tags) ? row.tags.map(value => text(value, 100)).filter(Boolean).join(', ') : text(row.tags, 1000),
      unit_cost: unitCost,
      rrp: money(row.rrp ?? row.retail_price ?? row.msrp),
      source_price: money(row.source_price ?? row.ambiguous_price ?? row.price),
    });
  }

  return { currency, prices_include_tax: pricesIncludeTax, source_price_column: sourcePriceColumn, supplier_name: supplierName, products };
}

export function resolveBulkProductSourcePrices(
  extraction: BulkProductDocumentImport,
  mapping: BulkProductSourcePriceMapping,
  currency: string,
  pricesIncludeTax: BulkProductDocumentImport['prices_include_tax'],
): BulkProductDocumentImport {
  const normalizedCurrency = text(currency, 3).toUpperCase() || 'UNKNOWN';
  return {
    ...extraction,
    currency: normalizedCurrency,
    prices_include_tax: pricesIncludeTax,
    products: extraction.products.map(product => {
      if (product.source_price === null || mapping === 'ignore') return product;
      if (mapping === 'rrp') return { ...product, rrp: product.source_price };
      const unitCost = normalizedCurrency === 'AUD' && pricesIncludeTax !== 'unknown'
        ? invoiceUnitPriceToProductCost(product.source_price, pricesIncludeTax, 0.1)
        : product.source_price;
      return { ...product, unit_cost: unitCost };
    }),
  };
}

export function prepareBulkProductPriceReview(extraction: BulkProductDocumentImport): BulkProductPriceReview | null {
  if (extraction.products.some(product => product.source_price !== null)) {
    return { extraction, suggestedMapping: '', reason: 'ambiguous_field' };
  }

  const hasCost = extraction.products.some(product => product.unit_cost !== null);
  const normalizedCurrency = extraction.currency.toUpperCase();
  const costReason = hasCost && normalizedCurrency === 'UNKNOWN'
    ? 'cost_currency'
    : hasCost && normalizedCurrency === 'AUD' && extraction.prices_include_tax === 'unknown'
      ? 'cost_tax'
      : null;
  if (costReason) {
    return {
      extraction: {
        ...extraction,
        source_price_column: extraction.source_price_column || 'Cost',
        products: extraction.products.map(product => ({ ...product, source_price: product.unit_cost, unit_cost: null })),
      },
      suggestedMapping: 'cost',
      reason: costReason,
    };
  }

  if (normalizedCurrency !== 'AUD' && extraction.products.some(product => product.rrp !== null)) {
    return {
      extraction: {
        ...extraction,
        source_price_column: extraction.source_price_column || 'RRP',
        products: extraction.products.map(product => ({ ...product, source_price: product.rrp, rrp: null })),
      },
      suggestedMapping: 'rrp',
      reason: 'rrp_currency',
    };
  }

  return null;
}
