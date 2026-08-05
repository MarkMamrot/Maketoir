export type ParsedInvoiceLine = {
  line_type?: 'product' | 'freight';
  product_code: string | null;
  barcode: string | null;
  product_name: string;
  qty: number;
  unit_price: number;
  rrp?: number | null;
  discount_pct: number;
  line_total: number;
  tax_rate: number;
  product_type?: string | null;
  brand?: string | null;
};

export type ParsedInvoice = {
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string;
  prices_include_tax: 'inc_tax' | 'ex_tax' | 'no_tax';
  subtotal: number | null;
  tax_total: number | null;
  total_amount: number | null;
  payment_terms: string | null;
  discount_total?: number | null;
  freight_total?: number | null;
  line_items: ParsedInvoiceLine[];
};

export function normalizeParsedInvoice(raw: Partial<ParsedInvoice> | null | undefined): ParsedInvoice {
  const rawLines = Array.isArray(raw?.line_items) ? raw.line_items : [];
  const isFreightLine = (line: any) => {
    if (String(line?.line_type ?? '').toLowerCase() === 'freight') return true;
    return /^(freight|shipping|delivery|postage)(?:\s+(?:charge|fee|cost))?s?$/i.test(String(line?.product_name ?? '').trim());
  };
  const freightLines = rawLines.filter(isFreightLine);
  const line_items = rawLines
    .filter((line: any) => !isFreightLine(line))
    .map((line: any) => ({
      line_type: 'product' as const,
      product_code: line?.product_code ?? null,
      barcode: line?.barcode ?? null,
      product_name: line?.product_name ?? '',
      qty: Number(line?.qty ?? 0),
      unit_price: Number(line?.unit_price ?? 0),
      rrp: line?.rrp == null ? null : Number(line.rrp),
      discount_pct: Number(line?.discount_pct ?? 0),
      line_total: Number(line?.line_total ?? 0),
      tax_rate: Number(line?.tax_rate ?? 0),
      product_type: line?.product_type ?? null,
      brand: line?.brand ?? null,
    }));
  const freightFromLines = freightLines.reduce((total: number, line: any) => {
    const lineTotal = Number(line?.line_total);
    if (Number.isFinite(lineTotal)) return total + lineTotal;
    return total + Number(line?.qty ?? 1) * Number(line?.unit_price ?? 0);
  }, 0);

  return {
    supplier_name: raw?.supplier_name ?? null,
    invoice_number: raw?.invoice_number ?? null,
    invoice_date: raw?.invoice_date ?? null,
    due_date: raw?.due_date ?? null,
    currency: raw?.currency ?? 'AUD',
    prices_include_tax: raw?.prices_include_tax ?? 'ex_tax',
    subtotal: raw?.subtotal ?? null,
    tax_total: raw?.tax_total ?? null,
    total_amount: raw?.total_amount ?? null,
    payment_terms: raw?.payment_terms ?? null,
    discount_total: raw?.discount_total ?? null,
    freight_total: freightLines.length > 0 && freightFromLines > 0 ? freightFromLines : raw?.freight_total ?? null,
    line_items,
  };
}
