import { afterEach, describe, expect, it, vi } from 'vitest';
import { AusPostApiError } from '../carriers/auspostEparcel/client';
import {
  amendmentRequestHash, getShipmentEditEligibility, isDefinitiveAmendmentRejection,
  validateAmendmentConcurrency, validateAmendmentIdentity,
} from '../shippingAmendmentPolicy';
import type { ShippingEditableDetail, ShippingAmendmentInput } from '../shippingAmendmentTypes';

const parcel = {
  parcelId: 12, providerItemId: 'item-12', packageType: 'box', parcelNumber: 1,
  lengthMm: 200, widthMm: 100, heightMm: 100, weightKg: 1, allocations: [{ soItemId: 5, quantity: 1 }],
};
const detail = {
  carrierAccountId: 9, providerShipmentId: 'shipment-1', isInternational: false,
  parcels: [parcel], revision: 2, updatedAt: '2026-10-12T01:02:03.000Z',
} as ShippingEditableDetail;
const draft = { carrierAccountId: 9, recipient: { country: 'AU' }, parcels: [parcel] } as ShippingAmendmentInput;

afterEach(() => vi.unstubAllEnvs());
describe('shipment edit eligibility', () => {
  it('keeps local drafts available when carrier amendments are explicitly disabled', () => {
    vi.stubEnv('AUSPOST_DOMESTIC_AMENDMENTS_VERIFIED', 'false');
    vi.stubEnv('AUSPOST_INTERNATIONAL_AMENDMENTS_VERIFIED', 'false');
    expect(getShipmentEditEligibility({ status: 'draft', provider_shipment_id: null }).eligible).toBe(true);
    expect(getShipmentEditEligibility({ status: 'label_ready', provider_shipment_id: 'existing', provider: 'auspost_eparcel' }).eligible).toBe(false);
  });
  it('enables verified domestic amendments by default while international remains disabled', () => {
    vi.stubEnv('AUSPOST_DOMESTIC_AMENDMENTS_VERIFIED', undefined);
    vi.stubEnv('AUSPOST_INTERNATIONAL_AMENDMENTS_VERIFIED', undefined);
    const row = { status: 'label_ready', provider_shipment_id: 'existing', provider: 'auspost_eparcel' };
    expect(getShipmentEditEligibility(row).eligible).toBe(true);
    expect(getShipmentEditEligibility({ ...row, is_international: 1 }).eligible).toBe(false);
  });
  it.each(['amending', 'amendment_unknown', 'submitting', 'submission_unknown', 'label_submitting', 'label_pending', 'label_unknown', 'manifested', 'complete', 'ims_fulfilled', 'voided', 'unknown'])('fails closed for %s', status => {
    vi.stubEnv('AUSPOST_DOMESTIC_AMENDMENTS_VERIFIED', 'true');
    expect(getShipmentEditEligibility({ status, provider_shipment_id: 'existing', provider: 'auspost_eparcel' }).eligible).toBe(false);
  });
  it.each(['manifest_id', 'ims_fulfilled_at', 'ims_fulfilment_operation_key'])('blocks %s even with an eligible status', field => {
    vi.stubEnv('AUSPOST_DOMESTIC_AMENDMENTS_VERIFIED', 'true');
    expect(getShipmentEditEligibility({ status: 'label_ready', provider_shipment_id: 'existing', provider: 'auspost_eparcel', [field]: 1 }).eligible).toBe(false);
  });
  it('requires separate verification for international amendments', () => {
    vi.stubEnv('AUSPOST_DOMESTIC_AMENDMENTS_VERIFIED', 'true');
    vi.stubEnv('AUSPOST_INTERNATIONAL_AMENDMENTS_VERIFIED', '');
    expect(getShipmentEditEligibility({ status: 'carrier_created', provider_shipment_id: 'existing', provider: 'auspost_eparcel', is_international: 1 }).eligible).toBe(false);
  });
});
describe('amendment identity and concurrency', () => {
  it('keeps existing shipment item identities', () => expect(() => validateAmendmentIdentity(detail, draft)).not.toThrow());
  it.each([
    { carrierAccountId: 10 }, { parcels: [] },
    { parcels: [{ ...parcel, providerItemId: 'replacement' }] },
    { parcels: [{ ...parcel, parcelId: 99 }] },
    { parcels: [{ ...parcel, parcelNumber: 2 }] },
    { recipient: { country: 'NZ' } },
  ])('rejects replacement or incompatible carrier changes %j', change => {
    expect(() => validateAmendmentIdentity(detail, { ...draft, ...change } as ShippingAmendmentInput)).toThrow();
  });
  it('allows local drafts to add parcels and change account', () => {
    expect(() => validateAmendmentIdentity({ ...detail, providerShipmentId: null }, {
      ...draft, carrierAccountId: 10, parcels: [{ ...parcel, parcelId: undefined, providerItemId: undefined }],
    })).not.toThrow();
  });
  it('rejects non-finite or over-precision allocations', () => {
    for (const quantity of [NaN, Infinity, 0, -1, 0.00001]) {
      expect(() => validateAmendmentIdentity(detail, { ...draft, parcels: [{ ...parcel, allocations: [{ soItemId: 5, quantity }] }] })).toThrow();
    }
  });
  it('rejects stale revision or time', () => {
    expect(() => validateAmendmentConcurrency(detail, { expectedRevision: 1, expectedUpdatedAt: detail.updatedAt })).toThrow(/changed/);
    expect(() => validateAmendmentConcurrency(detail, { expectedRevision: 2, expectedUpdatedAt: '2026-10-12T01:02:04Z' })).toThrow(/changed/);
    expect(() => validateAmendmentConcurrency(detail, { expectedRevision: 2, expectedUpdatedAt: detail.updatedAt })).not.toThrow();
  });
  it('hashes canonical objects but detects changed details', () => {
    expect(amendmentRequestHash({ a: 1, b: 2 })).toBe(amendmentRequestHash({ b: 2, a: 1 }));
    expect(amendmentRequestHash({ a: 1 })).not.toBe(amendmentRequestHash({ a: 2 }));
  });
});
describe('carrier rejection certainty', () => {
  it.each([400, 401, 403, 404, 422])('treats HTTP %s as definitive rejection', status => {
    expect(isDefinitiveAmendmentRejection(new AusPostApiError('Rejected', status, []))).toBe(true);
  });
  it.each([408, 409, 425, 429, 500, 502, 503])('does not treat HTTP %s as definitive', status => {
    expect(isDefinitiveAmendmentRejection(new AusPostApiError('Uncertain', status, []))).toBe(false);
  });
  it('does not treat timeout or malformed response as definitive', () => {
    expect(isDefinitiveAmendmentRejection(new Error('timeout'))).toBe(false);
  });
});
