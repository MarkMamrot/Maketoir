export type ParsedInvoiceLine = {
  line_type?: 'product' | 'freight' | 'backorder';
  product_code: string | null;
  barcode: string | null;
  product_name: string;
  qty: number;
  unit_price: number;
  rrp?: number | null;
  discount_amount?: number | null;
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

export function calculateTaxInclusiveRrp(cost: number, markupPercent: number, salesTaxRate: number): number {
  const safeCost = Number.isFinite(cost) ? Math.max(0, cost) : 0;
  const safeMarkup = Number.isFinite(markupPercent) ? Math.max(0, markupPercent) : 0;
  const safeTaxRate = Number.isFinite(salesTaxRate) ? Math.max(0, salesTaxRate) : 0;
  return Math.round(safeCost * (1 + safeMarkup / 100) * (1 + safeTaxRate) * 100) / 100;
}

export function invoiceUnitPriceToProductCost(
  unitPrice: number,
  taxTreatment: ParsedInvoice['prices_include_tax'],
  lineTaxRate: number,
): number {
  const safePrice = Number.isFinite(unitPrice) ? Math.max(0, unitPrice) : 0;
  const safeTaxRate = Number.isFinite(lineTaxRate) ? Math.max(0, lineTaxRate) : 0;
  const exTaxCost = taxTreatment === 'inc_tax' && safeTaxRate > 0 ? safePrice / (1 + safeTaxRate) : safePrice;
  return Math.round(exTaxCost * 10000) / 10000;
}

export function deriveInvoicePoLine(
  qty: number,
  printedLineTotal: number,
  printedUnitPrice: number,
  printedDiscountAmount?: number | null,
  printedDiscountPct?: number | null,
) {
  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const hasPrintedTotal = Number.isFinite(printedLineTotal) && printedLineTotal >= 0;
  const safeUnitPrice = Number.isFinite(printedUnitPrice) ? Math.max(0, printedUnitPrice) : 0;
  const grossTotal = safeQty * safeUnitPrice;
  const lineTotal = hasPrintedTotal
    ? Math.round(printedLineTotal * 100) / 100
    : Math.round(grossTotal * 100) / 100;
  const discountAmount = Number(printedDiscountAmount);
  const discountPct = Number(printedDiscountPct);
  const amountReconciles = Number.isFinite(discountAmount)
    && discountAmount > 0
    && grossTotal > 0
    && Math.abs(Math.round((grossTotal - discountAmount) * 100) / 100 - lineTotal) <= 0.01;
  const pctReconciles = !amountReconciles
    && Number.isFinite(discountPct)
    && discountPct > 0
    && discountPct <= 100
    && grossTotal > 0
    && Math.abs(Math.round(grossTotal * (1 - discountPct / 100) * 100) / 100 - lineTotal) <= 0.01;

  if (amountReconciles || pctReconciles) {
    const reconciledAmount = amountReconciles ? discountAmount : grossTotal - lineTotal;
    return {
      unitCost: Math.round(safeUnitPrice * 10000) / 10000,
      discountAmount: Math.round(reconciledAmount * 100) / 100,
      discountPct: Math.round((reconciledAmount / grossTotal) * 1000000) / 10000,
      lineTotal,
    };
  }

  return {
    unitCost: Math.round((lineTotal / safeQty) * 10000) / 10000,
    discountAmount: 0,
    discountPct: 0,
    lineTotal,
  };
}

export function normalizeParsedInvoice(raw: Partial<ParsedInvoice> | null | undefined): ParsedInvoice {
  const rawLines = Array.isArray(raw?.line_items) ? raw.line_items : [];
  const isFreightLine = (line: any) => {
    if (String(line?.line_type ?? '').toLowerCase() === 'freight') return true;
    return /^(freight|shipping|delivery|postage)(?:\s+(?:charge|fee|cost))?s?$/i.test(String(line?.product_name ?? '').trim());
  };
  const freightLines = rawLines.filter(isFreightLine);
  const line_items = rawLines
    .filter((line: any) => !isFreightLine(line) && String(line?.line_type ?? '').toLowerCase() !== 'backorder')
    .map((line: any) => {
      const qty = Number(line?.qty ?? 0);
      const rawUnitPrice = Number(line?.unit_price ?? 0);
      const rawDiscountPct = Number(line?.discount_pct ?? 0);
      const derived = deriveInvoicePoLine(
        qty,
        Number(line?.line_total),
        rawUnitPrice,
        line?.discount_amount == null ? null : Number(line.discount_amount),
        rawDiscountPct,
      );

      return {
        line_type: 'product' as const,
        product_code: line?.product_code ?? null,
        barcode: line?.barcode ?? null,
        product_name: line?.product_name ?? '',
        qty,
        unit_price: derived.unitCost,
        rrp: line?.rrp == null ? null : Number(line.rrp),
        discount_amount: derived.discountAmount,
        discount_pct: derived.discountPct,
        line_total: derived.lineTotal,
        tax_rate: Number(line?.tax_rate ?? 0),
        product_type: line?.product_type ?? null,
        brand: line?.brand ?? null,
      };
    });
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
