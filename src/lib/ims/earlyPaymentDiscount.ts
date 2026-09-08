export type EarlyPaymentDiscountPayment = {
  paymentDate: string;
  amountCents: number;
};

export type EarlyPaymentDiscountRule = {
  id: number;
  name: string;
  discountBasisPoints: number;
  discountDays: number;
  discountBase: 'merchandise';
  dateBasis: 'invoice_date_order_fallback';
};

export type EarlyPaymentDiscountSnapshot = {
  ruleId: number;
  name: string;
  discountBasisPoints: number;
  discountDays: number;
  discountBase: 'merchandise';
  dateBasis: 'invoice_date_order_fallback';
  cutoffDate: string;
  source: 'contact_default' | 'order_override';
};

export type EarlyPaymentDiscountInput = {
  documentDate: string;
  discountDays: number;
  discountBasisPoints: number;
  taxableMerchandiseNetCents: number;
  taxableMerchandiseTaxCents: number;
  taxFreeMerchandiseCents: number;
  documentTotalCents: number;
  payments: EarlyPaymentDiscountPayment[];
};

export type EarlyPaymentDiscountResult = {
  cutoffDate: string;
  taxableDiscountNetCents: number;
  taxFreeDiscountCents: number;
  discountNetCents: number;
  discountTaxCents: number;
  discountGrossCents: number;
  discountedSettlementCents: number;
  paidByCutoffCents: number;
  eligible: boolean;
};

export type EarlyPaymentDiscountOrderPreviewInput = {
  cutoffDate: string;
  discountDays: number;
  discountBasisPoints: number;
  taxTreatment: 'ex_tax' | 'inc_tax' | 'no_tax';
  orderDiscount: number;
  documentTotal: number;
  items: Array<{ lineTotal: number; taxRate: number }>;
  payments: Array<{ paymentDate: string; amount: number }>;
  proposedPayment?: { paymentDate: string; amount: number };
};

export type EarlyPaymentDiscountOrderPreview = EarlyPaymentDiscountResult & {
  hasRule: true;
  remainingSettlementCents: number;
  excessSettlementCents: number;
  proposedPaymentCents: number;
};

export type PersistedEarlyPaymentDiscountOrder = {
  early_payment_discount_name?: string | null;
  early_payment_discount_basis_points?: number | null;
  early_payment_discount_days?: number | null;
  early_payment_discount_cutoff_date?: string | null;
  tax_treatment?: 'ex_tax' | 'inc_tax' | 'no_tax' | null;
  discount?: number | null;
  total_amount?: number | null;
  items?: Array<{ line_total?: number | null; tax_rate?: number | null }>;
  payments?: Array<{ payment_date?: string | null; amount?: number | null }>;
};

export type PersistedEarlyPaymentDiscountPreview =
  | { available: false; reason: 'no_early_payment_discount' }
  | ({ available: true; name: string } & EarlyPaymentDiscountOrderPreview);

function requireNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
}

function parseDateOnly(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a valid calendar date.`);
  }
  return date;
}

function addDays(value: string, days: number): string {
  const date = parseDateOnly(value, 'documentDate');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function percentageOfCents(cents: number, basisPoints: number): number {
  return Math.round((cents * basisPoints) / 10_000);
}

function moneyToCents(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number.`);
  return Math.round(value * 100);
}

export function buildEarlyPaymentDiscountOrderPreview(input: EarlyPaymentDiscountOrderPreviewInput): EarlyPaymentDiscountOrderPreview {
  parseDateOnly(input.cutoffDate, 'cutoffDate');
  const components = input.items.reduce((totals, item, index) => {
    const lineCents = moneyToCents(item.lineTotal, `items[${index}].lineTotal`);
    const taxRate = Number(item.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0) throw new Error(`items[${index}].taxRate must be non-negative.`);
    if (input.taxTreatment === 'no_tax' || taxRate === 0) {
      totals.taxFreeCents += lineCents;
    } else if (input.taxTreatment === 'inc_tax') {
      const netCents = Math.round(lineCents / (1 + taxRate));
      totals.taxableNetCents += netCents;
      totals.taxableTaxCents += lineCents - netCents;
    } else {
      totals.taxableNetCents += lineCents;
      totals.taxableTaxCents += Math.round(lineCents * taxRate);
    }
    return totals;
  }, { taxableNetCents: 0, taxableTaxCents: 0, taxFreeCents: 0 });

  const merchandiseGrossCents = components.taxableNetCents + components.taxableTaxCents + components.taxFreeCents;
  const orderDiscountCents = Math.min(moneyToCents(input.orderDiscount, 'orderDiscount'), merchandiseGrossCents);
  const remainingRatio = merchandiseGrossCents > 0 ? (merchandiseGrossCents - orderDiscountCents) / merchandiseGrossCents : 0;
  const taxableMerchandiseNetCents = Math.round(components.taxableNetCents * remainingRatio);
  const taxableMerchandiseTaxCents = Math.round(components.taxableTaxCents * remainingRatio);
  const taxFreeMerchandiseCents = Math.max(
    0,
    merchandiseGrossCents - orderDiscountCents - taxableMerchandiseNetCents - taxableMerchandiseTaxCents,
  );
  const proposedPaymentCents = input.proposedPayment ? moneyToCents(input.proposedPayment.amount, 'proposedPayment.amount') : 0;
  const result = calculateEarlyPaymentDiscount({
    documentDate: input.cutoffDate,
    discountDays: 0,
    discountBasisPoints: input.discountBasisPoints,
    taxableMerchandiseNetCents,
    taxableMerchandiseTaxCents,
    taxFreeMerchandiseCents,
    documentTotalCents: moneyToCents(input.documentTotal, 'documentTotal'),
    payments: [
      ...input.payments.map(payment => ({ paymentDate: payment.paymentDate, amountCents: moneyToCents(payment.amount, 'payment.amount') })),
      ...(input.proposedPayment ? [{ paymentDate: input.proposedPayment.paymentDate, amountCents: proposedPaymentCents }] : []),
    ],
  });
  return {
    ...result,
    hasRule: true,
    cutoffDate: input.cutoffDate,
    proposedPaymentCents,
    remainingSettlementCents: Math.max(0, result.discountedSettlementCents - result.paidByCutoffCents),
    excessSettlementCents: Math.max(0, result.paidByCutoffCents - result.discountedSettlementCents),
    eligible: result.eligible && result.paidByCutoffCents === result.discountedSettlementCents,
  };
}

export function buildEarlyPaymentDiscountSnapshot(input: {
  rule: EarlyPaymentDiscountRule;
  documentType: 'purchase_order' | 'sales_order';
  orderDate: string;
  supplierInvoiceDate?: string | null;
  source: EarlyPaymentDiscountSnapshot['source'];
}): EarlyPaymentDiscountSnapshot {
  const { rule } = input;
  requireNonNegativeInteger(rule.id, 'rule.id');
  requireNonNegativeInteger(rule.discountBasisPoints, 'rule.discountBasisPoints');
  requireNonNegativeInteger(rule.discountDays, 'rule.discountDays');
  if (rule.discountBasisPoints === 0 || rule.discountBasisPoints > 10_000) {
    throw new Error('rule.discountBasisPoints must be between 1 and 10000.');
  }
  if (!rule.name.trim()) throw new Error('rule.name is required.');
  if (rule.discountBase !== 'merchandise') throw new Error('Unsupported early-payment discount base.');
  if (rule.dateBasis !== 'invoice_date_order_fallback') throw new Error('Unsupported early-payment date basis.');

  const documentDate = input.documentType === 'purchase_order' && input.supplierInvoiceDate
    ? input.supplierInvoiceDate
    : input.orderDate;

  return {
    ruleId: rule.id,
    name: rule.name.trim(),
    discountBasisPoints: rule.discountBasisPoints,
    discountDays: rule.discountDays,
    discountBase: rule.discountBase,
    dateBasis: rule.dateBasis,
    cutoffDate: addDays(documentDate, rule.discountDays),
    source: input.source,
  };
}

export function calculateEarlyPaymentDiscount(input: EarlyPaymentDiscountInput): EarlyPaymentDiscountResult {
  requireNonNegativeInteger(input.discountDays, 'discountDays');
  requireNonNegativeInteger(input.discountBasisPoints, 'discountBasisPoints');
  if (input.discountBasisPoints > 10_000) throw new Error('discountBasisPoints cannot exceed 10000.');

  requireNonNegativeInteger(input.taxableMerchandiseNetCents, 'taxableMerchandiseNetCents');
  requireNonNegativeInteger(input.taxableMerchandiseTaxCents, 'taxableMerchandiseTaxCents');
  requireNonNegativeInteger(input.taxFreeMerchandiseCents, 'taxFreeMerchandiseCents');
  requireNonNegativeInteger(input.documentTotalCents, 'documentTotalCents');

  const cutoffDate = addDays(input.documentDate, input.discountDays);
  const taxableDiscountNetCents = percentageOfCents(input.taxableMerchandiseNetCents, input.discountBasisPoints);
  const taxFreeDiscountCents = percentageOfCents(input.taxFreeMerchandiseCents, input.discountBasisPoints);
  const discountNetCents = taxableDiscountNetCents + taxFreeDiscountCents;
  const discountTaxCents = percentageOfCents(input.taxableMerchandiseTaxCents, input.discountBasisPoints);
  const discountGrossCents = discountNetCents + discountTaxCents;
  const discountedSettlementCents = Math.max(0, input.documentTotalCents - discountGrossCents);

  const paidByCutoffCents = input.payments.reduce((total, payment, index) => {
    requireNonNegativeInteger(payment.amountCents, `payments[${index}].amountCents`);
    parseDateOnly(payment.paymentDate, `payments[${index}].paymentDate`);
    return payment.paymentDate <= cutoffDate ? total + payment.amountCents : total;
  }, 0);

  return {
    cutoffDate,
    taxableDiscountNetCents,
    taxFreeDiscountCents,
    discountNetCents,
    discountTaxCents,
    discountGrossCents,
    discountedSettlementCents,
    paidByCutoffCents,
    eligible: input.discountBasisPoints > 0
      && discountGrossCents > 0
      && paidByCutoffCents >= discountedSettlementCents,
  };
}

export function previewPersistedEarlyPaymentDiscountOrder(
  order: PersistedEarlyPaymentDiscountOrder,
  proposedPayment?: { paymentDate: string; amount: number },
): PersistedEarlyPaymentDiscountPreview {
  const cutoffDate = String(order.early_payment_discount_cutoff_date ?? '').slice(0, 10);
  const basisPoints = Number(order.early_payment_discount_basis_points ?? 0);
  const name = String(order.early_payment_discount_name ?? '').trim();
  if (!cutoffDate || !basisPoints || !name) return { available: false, reason: 'no_early_payment_discount' };

  return {
    available: true,
    name,
    ...buildEarlyPaymentDiscountOrderPreview({
      cutoffDate,
      discountDays: Number(order.early_payment_discount_days ?? 0),
      discountBasisPoints: basisPoints,
      taxTreatment: order.tax_treatment ?? 'ex_tax',
      orderDiscount: Number(order.discount ?? 0),
      documentTotal: Number(order.total_amount ?? 0),
      items: (order.items ?? []).map(item => ({ lineTotal: Number(item.line_total ?? 0), taxRate: Number(item.tax_rate ?? 0) })),
      payments: (order.payments ?? []).map(payment => ({
        paymentDate: String(payment.payment_date ?? '').slice(0, 10),
        amount: Number(payment.amount ?? 0),
      })),
      proposedPayment,
    }),
  };
}