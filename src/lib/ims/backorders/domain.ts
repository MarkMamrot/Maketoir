const QUANTITY_SCALE = 10_000;

export type BackorderLineSplit = {
  orderedQty: number;
  actualQty: number;
  backorderQty: number;
};

export type BackorderCommercialLine = {
  variantId: string | null;
  unitAmount: number;
  discountPct?: number | null;
  taxRate?: number | null;
  notes?: string | null;
};

export type BackorderMergeDocument = {
  businessId: string;
  contactId: number | null;
  locationId: number;
  currencyCode: string;
  exchangeRate?: number | null;
  taxTreatment: string;
  taxCode?: string | null;
  paymentTerms?: string | null;
  priceTier?: string | null;
  externalReference?: string | null;
};

function toScaledQuantity(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Quantity must be a finite number.');
  return Math.round(value * QUANTITY_SCALE);
}

function normalizeOptional(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

export function calculateBackorderSplit(orderedQty: number, actualQty: number): BackorderLineSplit {
  const ordered = toScaledQuantity(orderedQty);
  const actual = toScaledQuantity(actualQty);
  if (ordered <= 0) throw new Error('Ordered quantity must be greater than zero.');
  if (actual < 0) throw new Error('Actual quantity cannot be negative.');
  if (actual > ordered) throw new Error('Actual quantity cannot exceed ordered quantity.');

  return {
    orderedQty: ordered / QUANTITY_SCALE,
    actualQty: actual / QUANTITY_SCALE,
    backorderQty: (ordered - actual) / QUANTITY_SCALE,
  };
}

export function nextBackorderNumber(sourceNumber: string, existingNumbers: Iterable<string>): string {
  const normalizedSource = sourceNumber.trim();
  if (!normalizedSource) throw new Error('Source order number is required.');

  const existing = new Set(Array.from(existingNumbers, value => value.trim().toUpperCase()));
  let sequence = 1;
  while (true) {
    const candidate = `${normalizedSource}-B${sequence === 1 ? '' : sequence}`;
    if (!existing.has(candidate.toUpperCase())) return candidate;
    sequence++;
  }
}

export function commercialLineKey(line: BackorderCommercialLine): string {
  return JSON.stringify([
    line.variantId ?? '',
    Number(line.unitAmount).toFixed(4),
    Number(line.discountPct ?? 0).toFixed(4),
    Number(line.taxRate ?? 0).toFixed(4),
    normalizeOptional(line.notes),
  ]);
}

export function isOrderXeroEligible(status: string): boolean {
  return status !== 'backordered';
}

export function getBackorderMergeConflict(
  target: BackorderMergeDocument,
  candidate: BackorderMergeDocument,
): string | null {
  const comparisons: Array<[string, string | number | null, string | number | null]> = [
    ['business', target.businessId, candidate.businessId],
    ['contact', target.contactId, candidate.contactId],
    ['location', target.locationId, candidate.locationId],
    ['currency', target.currencyCode.toUpperCase(), candidate.currencyCode.toUpperCase()],
    ['exchange rate', Number(target.exchangeRate ?? 1), Number(candidate.exchangeRate ?? 1)],
    ['tax treatment', target.taxTreatment, candidate.taxTreatment],
    ['tax code', normalizeOptional(target.taxCode), normalizeOptional(candidate.taxCode)],
    ['payment terms', normalizeOptional(target.paymentTerms), normalizeOptional(candidate.paymentTerms)],
    ['price tier', normalizeOptional(target.priceTier), normalizeOptional(candidate.priceTier)],
    ['external reference', normalizeOptional(target.externalReference), normalizeOptional(candidate.externalReference)],
  ];

  const conflict = comparisons.find(([, targetValue, candidateValue]) => targetValue !== candidateValue);
  return conflict ? `${conflict[0]} does not match.` : null;
}