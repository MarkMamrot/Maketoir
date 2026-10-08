export const fields = {
  orderRef: 'Order Ref', invoiceNo: 'Invoice No.', invoiceDate: 'Invoice Date', saleDate: 'Sale Date',
  movementDate: 'Movement Date', customer: 'Customer Name', channel: 'Sales Channel', channelInstance: 'Channel Instance',
  salesRep: 'Sales Rep', cashier: 'Cashier', brand: 'Brand (current)', sku: 'Product/SKU', description: 'Product Description',
  warehouse: 'Warehouse Location', posLocation: 'POS Location', fulfilmentLocation: 'Fulfilment Location',
  dispatchDate: 'Dispatch Date', shipmentDate: 'Shipment Date', deliveryDate: 'Delivery Date', batch: 'Receipt Layer / Batch',
  currency: 'Currency', orderStatus: 'Sales Order Status', invoiceStatus: 'Invoice Status', creditRef: 'Return/Credit Note Reference',
  costMethod: 'Cost Method', movementId: 'Movement ID', source: 'Source', quality: 'Evidence Status',
  qty: 'Qty Sold', sales: 'Sales (AUD ex GST)', discount: 'Discount (AUD ex GST)', netSales: 'Net Sales (AUD ex GST)',
  cogs: 'COGS (AUD)', knownCogs: 'Captured COGS (AUD)', gp: 'GP (AUD)', gpPercent: 'GP %', tax: 'Tax/GST (AUD)',
  documentNetSales: 'Net Sales (document currency)', documentTax: 'GST (document currency)',
} as const;

export type Field = keyof typeof fields;
export const metrics: Field[] = ['qty', 'sales', 'discount', 'netSales', 'cogs', 'knownCogs', 'gp', 'gpPercent', 'tax', 'documentNetSales', 'documentTax'];
export type ReportRow = Record<Field, string | number | null> & {
  id: string; sourceHref: string | null;
  costedRecords?: number; missingCosts?: number; missingRevenue?: number;
  knownSales?: number; knownDiscount?: number; knownNetSales?: number; knownGp?: number; coveredGpRecords?: number;
};
export type Basis = 'movement' | 'sale';
export type Filter = { field: Field; operator: 'contains' | 'equals' | 'gte' | 'lte' | 'missing'; value: string };

export function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function exclusive(amount: number, rate: number, basis: string): number {
  return basis === 'inc_tax' ? amount / (1 + Math.max(0, rate)) : amount;
}

export function financials(input: {
  gross: number | null; net: number | null; tax: number | null; currency: string;
  exchangeRate: number | null; cogs: number | null;
}) {
  const rate = input.currency === 'AUD' ? 1 : input.exchangeRate;
  const convert = (amount: number | null) => amount == null || rate == null || rate <= 0 ? null : amount * rate;
  const sales = convert(input.gross);
  const netSales = convert(input.net);
  const tax = convert(input.tax);
  const discount = sales == null || netSales == null ? null : sales - netSales;
  const gp = netSales == null || input.cogs == null ? null : netSales - input.cogs;
  return { sales, netSales, tax, discount, cogs: input.cogs, knownCogs: input.cogs, gp, gpPercent: gp == null || netSales === 0 || netSales == null ? null : gp / netSales * 100 };
}

export function emptyRow(id: string): ReportRow {
  return { ...Object.fromEntries(Object.keys(fields).map(field => [field, null])), id, sourceHref: null } as ReportRow;
}

export function matches(row: ReportRow, filters: Filter[]): boolean {
  return filters.every(filter => {
    const value = row[filter.field];
    if (filter.operator === 'missing') return value == null || value === '';
    if (value == null) return false;
    if (filter.operator === 'gte' || filter.operator === 'lte') {
      if (metrics.includes(filter.field)) {
        const bound = numberOrNull(filter.value);
        return bound != null && (filter.operator === 'gte' ? Number(value) >= bound : Number(value) <= bound);
      }
      return filter.operator === 'gte' ? String(value) >= filter.value : String(value) <= filter.value;
    }
    const actual = String(value).toLowerCase();
    return filter.operator === 'equals' ? actual === filter.value.toLowerCase() : actual.includes(filter.value.toLowerCase());
  });
}

export function summarise(rows: ReportRow[]) {
  const sum = (field: Field) => rows.reduce((total, row) => total + (numberOrNull(row[field]) ?? 0), 0);
  const complete = (field: Field) => rows.every(row => row[field] != null);
  const netSales = complete('netSales') ? sum('netSales') : null;
  const cogs = complete('cogs') ? sum('cogs') : null;
  const gp = netSales == null || cogs == null ? null : netSales - cogs;
  const known = (field: 'sales' | 'discount' | 'netSales' | 'gp') => rows.reduce((total, row) => total + (numberOrNull(row[field]) ?? 0), 0);
  return {
    rows: rows.length, qty: sum('qty'), sales: complete('sales') ? sum('sales') : null,
    discount: complete('discount') ? sum('discount') : null, netSales, cogs, gp,
    gpPercent: gp == null || netSales == null || netSales === 0 ? null : gp / netSales * 100,
    tax: complete('tax') ? sum('tax') : null,
    documentNetSales: new Set(rows.map(row => row.currency)).size <= 1 && complete('documentNetSales') ? sum('documentNetSales') : null,
    documentTax: new Set(rows.map(row => row.currency)).size <= 1 && complete('documentTax') ? sum('documentTax') : null,
    knownCogs: rows.reduce((total, row) => total + (numberOrNull(row.cogs) ?? numberOrNull(row.knownCogs) ?? 0), 0),
    knownSales: known('sales'), knownDiscount: known('discount'), knownNetSales: known('netSales'), knownGp: known('gp'),
    costedRecords: rows.filter(row => row.cogs != null || (row.knownCogs != null && (row.costedRecords ?? 1) > 0)).length,
    missingCosts: rows.filter(row => row.cogs == null).length,
    missingRevenue: rows.filter(row => row.netSales == null).length,
  };
}

export function groupRows(rows: ReportRow[], groups: Field[]): ReportRow[] {
  const buckets = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = JSON.stringify(groups.map(field => row[field]));
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  return Array.from(buckets, ([key, members]) => {
    const row = emptyRow(key);
    for (const field of groups) row[field] = members[0][field];
    Object.assign(row, summarise(members));
    row.currency = new Set(members.map(member => member.currency)).size === 1 ? members[0].currency : 'Mixed (AUD totals)';
    row.quality = `${members.length} records; ${members.filter(member => member.cogs == null || member.netSales == null).length} incomplete`;
    return row;
  });
}

export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (typeof value !== 'number' && /^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvRows(rows: ReportRow[], columns: Field[]): string {
  return [columns.map(field => csvCell(fields[field])).join(','), ...rows.map(row => columns.map(field => csvCell(row[field])).join(','))].join('\r\n');
}