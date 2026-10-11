import { describe, expect, it } from 'vitest';
import { assessInvoiceMatchEvidence, collectInvoiceImportLines, createInvoiceVariantMatcher, invoiceMatchNeedsReview, selectInvoiceMatchCandidates, validateInvoiceAiMatches } from '../invoiceProductMatching';

const variants = [
  { variant_id: 'first', sku: 'FC-AJ02', barcode: '00123', product_name: 'Fox shirt', variant_label: 'Small' },
  { variant_id: 'second', sku: 'FC-LL1207', barcode: '00456', product_name: 'Fox shirt', variant_label: 'Large' },
];

describe('invoice product matching', () => {
  const evidenceInput = { confidence: 'exact_sku', supplierExact: true, supplierId: 5, variant: { variant_id: 'first', supplier_contact_id: 5, cost_aud: 10 }, line: { unit_price: 11, qty: 2, line_total: 17.6, tax_rate: 0.1 }, currency: 'AUD', taxTreatment: 'inc_tax' };
  it('supports either undiscounted or discounted cost after extracting GST', () => {
    expect(assessInvoiceMatchEvidence(evidenceInput)).toMatchObject({ costStatus: 'supports_match', requiresReview: false, undiscountedCost: 10, discountedCost: 8 });
    expect(assessInvoiceMatchEvidence({ ...evidenceInput, variant: { ...evidenceInput.variant, cost_aud: 8 } })).toMatchObject({ costStatus: 'supports_match', requiresReview: false });
  });
  it('does not let similar costs remove supplier or code review flags', () => {
    expect(assessInvoiceMatchEvidence({ ...evidenceInput, supplierExact: false }).requiresReview).toBe(true);
    expect(assessInvoiceMatchEvidence({ ...evidenceInput, supplierId: 6 }).requiresReview).toBe(true);
    expect(assessInvoiceMatchEvidence({ ...evidenceInput, confidence: 'fuzzy_name' }).requiresReview).toBe(true);
  });
  it('flags costs beyond 5% and includes the threshold', () => {
    expect(assessInvoiceMatchEvidence({ ...evidenceInput, taxTreatment: 'ex_tax', line: { unit_price: 10.5, qty: 1, line_total: 10.5 } }).costStatus).toBe('supports_match');
    expect(assessInvoiceMatchEvidence({ ...evidenceInput, taxTreatment: 'ex_tax', line: { unit_price: 10.51, qty: 1, line_total: 10.51 } })).toMatchObject({ costStatus: 'differs', requiresReview: true });
  });
  it('does not compare unknown tax, currency, or missing costs', () => {
    for (const changes of [{ currency: '' }, { taxTreatment: null }, { currency: 'USD' }, { line: { unit_price: 11, qty: 1 } }]) {
      expect(assessInvoiceMatchEvidence({ ...evidenceInput, ...changes }).costStatus).toBe('not_comparable');
    }
  });
  it('uses same-currency foreign Cost without converting AUD', () => {
    expect(assessInvoiceMatchEvidence({ ...evidenceInput, currency: 'USD', taxTreatment: 'no_tax', variant: { ...evidenceInput.variant, cost_foreign: '{"USD":11}' } }).costStatus).toBe('supports_match');
  });
  it('uses costs to support identity candidates but never creates price-only candidates', () => {
    const candidates = [
      { variant_id: 'a', product_name: 'Fox shirt', cost_aud: 30 },
      { variant_id: 'b', product_name: 'Fox shirt', cost_aud: 10 },
      { variant_id: 'c', product_name: 'Unrelated mug', cost_aud: 10 },
    ];
    expect(selectInvoiceMatchCandidates({ product_name: 'Fox shirt', unit_price: 10, qty: 1, line_total: 10 }, candidates, 20, { currency: 'AUD', taxTreatment: 'ex_tax' }).map(candidate => candidate.variant_id)).toEqual(['b', 'a']);
  });
  it('finds exact identifiers regardless of catalogue ordering and length', () => {
    const catalogue = Array.from({ length: 2500 }, (_, index) => ({ variant_id: `other-${index}`, sku: `OTHER-${index}` }));
    expect(createInvoiceVariantMatcher([...catalogue, ...variants])({ product_code: ' fc-aj02 ' })).toMatchObject({ variant_id: 'first', confidence: 'exact_sku' });
  });
  it('preserves barcode leading zeroes', () => {
    expect(createInvoiceVariantMatcher(variants)({ barcode: '00123' })).toMatchObject({ variant_id: 'first', confidence: 'exact_barcode' });
  });
  it('flags spacing-normalized codes for review', () => {
    const match = createInvoiceVariantMatcher(variants)({ product_code: 'FC - AJ02' });
    expect(match).toMatchObject({ variant_id: 'first', confidence: 'normalized_sku' });
    expect(invoiceMatchNeedsReview(match?.confidence)).toBe(true);
  });
  it('does not pick the first ambiguous name or duplicate SKU', () => {
    expect(createInvoiceVariantMatcher(variants)({ product_name: 'Fox shirt' })).toBeNull();
    expect(createInvoiceVariantMatcher([...variants, { ...variants[0], variant_id: 'duplicate' }])({ product_code: 'FC-AJ02' })).toBeNull();
  });
  it('rejects conflicting SKU and barcode identities', () => {
    expect(createInvoiceVariantMatcher(variants)({ product_code: 'FC-AJ02', barcode: '00456' })).toBeNull();
  });
  it('requires review for all inferred matches, including AI high confidence', () => {
    for (const confidence of ['fuzzy_name', 'ai_high', 'ai_match', null]) expect(invoiceMatchNeedsReview(confidence)).toBe(true);
    for (const confidence of ['exact_sku', 'exact_barcode', 'manual']) expect(invoiceMatchNeedsReview(confidence)).toBe(false);
  });
  it('retains original indexes after excluding earlier rows', () => {
    expect(collectInvoiceImportLines(['skip', 'keep'], new Set([0]), (line, index) => `${index}:${line}`)).toEqual(['1:keep']);
  });
  it('ranks a bounded candidate list deterministically', () => {
    const line = { product_name: 'Fox shirt Small' };
    expect(selectInvoiceMatchCandidates(line, variants, 1)[0].variant_id).toBe('first');
    expect(selectInvoiceMatchCandidates(line, [...variants].reverse(), 1)[0].variant_id).toBe('first');
  });
  it('rejects duplicate row results, unknown confidence, and candidates from other rows', () => {
    const lines = [{ index: 5, candidates: [variants[0]] }];
    for (const raw of [
      [{ invoice_index: 5, variant_id: 'second', confidence: 'high' }],
      [{ invoice_index: 5, variant_id: 'first', confidence: 'certain' }],
      [{ invoice_index: 5, variant_id: 'first', confidence: 'high' }, { invoice_index: 5, variant_id: 'first', confidence: 'high' }],
      { matches: 'invalid' },
    ]) expect(validateInvoiceAiMatches(raw, lines)[0].variant_id).toBeNull();
  });
  it('retains every requested row even when AI omits rows', () => {
    const result = validateInvoiceAiMatches([{ invoice_index: 8, variant_id: 'first', confidence: 'high' }], [{ index: 8, candidates: [variants[0]] }, { index: 12, candidates: variants }]);
    expect(result).toHaveLength(2);
    expect(result[0].variant_id).toBe('first');
    expect(result[1]).toMatchObject({ invoice_index: 12, variant_id: null });
  });
});