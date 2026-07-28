export type ParsedInvoiceLine = {
  product_code: string | null;
  barcode: string | null;
  product_name: string;
  qty: number;
  unit_price: number;
  rrp?: number | null;
  discount_pct: number;
  line_total: number;
  tax_rate: number;
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
  line_items: ParsedInvoiceLine[];
};

export function normalizeParsedInvoice(raw: Partial<ParsedInvoice> | null | undefined): ParsedInvoice {
  const line_items = Array.isArray(raw?.line_items)
    ? raw!.line_items.map((line: any) => ({
        product_code: line?.product_code ?? null,
        barcode: line?.barcode ?? null,
        product_name: line?.product_name ?? '',
        qty: Number(line?.qty ?? 0),
        unit_price: Number(line?.unit_price ?? 0),
        rrp: line?.rrp == null ? null : Number(line.rrp),
        discount_pct: Number(line?.discount_pct ?? 0),
        line_total: Number(line?.line_total ?? 0),
        tax_rate: Number(line?.tax_rate ?? 0),
      }))
    : [];

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
    line_items,
  };
}
