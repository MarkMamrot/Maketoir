import { invoiceUnitPriceToProductCost } from './invoiceImportParser';

export type BulkProductDocumentLine = {
  product_name: string;
  product_code: string;
  barcode: string;
  description: string;
  brand: string;
  product_type: string;
  category: string;
  tags: string;
  unit_cost: number | null;
  rrp: number | null;
};

export type BulkProductDocumentImport = {
  currency: string;
  prices_include_tax: 'inc_tax' | 'ex_tax' | 'no_tax' | 'unknown';
  products: BulkProductDocumentLine[];
};

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
  const currency = text(source.currency, 3).toUpperCase() || 'UNKNOWN';
  const rawTaxTreatment = text(source.prices_include_tax, 20);
  const pricesIncludeTax = ['inc_tax', 'ex_tax', 'no_tax'].includes(rawTaxTreatment)
    ? rawTaxTreatment as BulkProductDocumentImport['prices_include_tax']
    : 'unknown';
  const rows = Array.isArray(source.products) ? source.products : Array.isArray(source.line_items) ? source.line_items : [];
  const products: BulkProductDocumentLine[] = [];
  const seen = new Set<string>();

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
    const normalized = {
      product_name: productName,
      product_code: productCode,
      barcode,
      description: text(row.description, 5000),
      brand: text(row.brand, 255),
      product_type: text(row.product_type, 100),
      category: text(row.category, 100),
      tags: Array.isArray(row.tags) ? row.tags.map(value => text(value, 100)).filter(Boolean).join(', ') : text(row.tags, 1000),
      unit_cost: unitCost,
      rrp: money(row.rrp ?? row.retail_price ?? row.msrp),
    };
    const identity = JSON.stringify(normalized);
    if (seen.has(identity)) continue;
    seen.add(identity);
    products.push(normalized);
  }

  return { currency, prices_include_tax: pricesIncludeTax, products };
}
