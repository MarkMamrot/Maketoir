import { describe, expect, it } from 'vitest';
import { deliveryReviewDeadline, deliveryReviewIsDue, validateDeliveryEvidenceReport, validateManualDeliveryRequest, verifiedDeliveryTimestamp } from '../amazonDeliveryEvidence';

const now = new Date('2026-10-15T00:00:00Z');
const operationKey = '12345678-1234-4234-9234-123456789abc';
const request = () => ({
  action: 'record', salesOrderId: 42, parcelId: null, deliveredAt: '2025-09-01T10:00:00+10:00',
  basis: 'carrier-portal', reference: 'TICKET-123', operationKey, verified: true,
});

describe('verified Amazon original-delivery evidence', () => {
  it('normalizes explicit offsets and carrier fractional seconds to UTC', () => {
    expect(verifiedDeliveryTimestamp('2025-09-01T10:00:00+10:00', now)).toBe('2025-09-01T00:00:00.000Z');
    expect(verifiedDeliveryTimestamp('2025-09-01T10:00:00.123456+10:00', now)).toBe('2025-09-01T00:00:00.123Z');
  });
  it.each([
    '2025-09-01', '2025-09-01T10:00:00', '2025-02-30T10:00:00Z', '2025-02-29T10:00:00Z',
    '2025-01-01T24:00:00Z', '2025-01-01T10:60:00Z', '2025-01-01T10:00:60Z',
    '2025-01-01T10:00:00+14:30', '2025-01-01T10:00:00+10:60', '2027-01-01T00:00:00Z',
  ])('rejects invalid, unzoned or future delivery instead of guessing (%s)', value => {
    expect(() => verifiedDeliveryTimestamp(value, now)).toThrow();
  });
  it('sets the exact 30-day boundary from delivery, across DST/month changes', () => {
    const delivered = verifiedDeliveryTimestamp('2025-03-15T12:00:00+11:00', now);
    const deadline = deliveryReviewDeadline(delivered);
    expect(deadline).toBe('2025-04-14T01:00:00.000Z');
    expect(Date.parse(deadline) - Date.parse(delivered)).toBe(30 * 24 * 60 * 60 * 1_000);
    expect(deliveryReviewIsDue(delivered, new Date(Date.parse(deadline) - 1))).toBe(false);
    expect(deliveryReviewIsDue(delivered, new Date(deadline))).toBe(true);
    expect(deliveryReviewIsDue(delivered, new Date(Date.parse(deadline) + 1))).toBe(true);
  });
  it('requires independent verification and whitelists only minimal audit inputs', () => {
    expect(validateManualDeliveryRequest(request(), now)).toEqual({
      action: 'record', salesOrderId: 42, parcelId: null, deliveredAt: '2025-09-01T00:00:00.000Z',
      basis: 'carrier-portal', reference: 'TICKET-123', operationKey,
    });
    expect(() => validateManualDeliveryRequest({ ...request(), verified: false }, now)).toThrow();
  });
  it.each(['businessId', 'actorUserId', 'recipient', 'rawPayload', 'source'])('rejects scope, identity or payload overrides (%s)', key => {
    expect(() => validateManualDeliveryRequest({ ...request(), [key]: 'override' }, now)).toThrow();
  });
  it.each(['Jane Customer', 'buyer@example.com', 'https://tracking.example/test', 'TICKET-123\n'])('rejects free-text or link evidence (%s)', reference => {
    expect(() => validateManualDeliveryRequest({ ...request(), reference }, now)).toThrow();
  });
  it('validates append-only correction requests', () => {
    expect(validateManualDeliveryRequest({ action: 'void', salesOrderId: 42, evidenceId: 7, reason: 'wrong-date', operationKey }, now))
      .toMatchObject({ action: 'void', evidenceId: 7 });
    expect(() => validateManualDeliveryRequest({ action: 'void', salesOrderId: 42, evidenceId: 7, reason: 'extend deadline', operationKey }, now)).toThrow();
  });
  it('validates and strips delivery report output, including nested payloads', () => {
    const result = validateDeliveryEvidenceReport({
      salesOrderId: 42, earliestVerifiedDeliveryAt: null, reviewDeadlineAt: null, hasMoreHistory: false,
      buyer: 'must not escape',
      parcels: [{ id: 9, shipmentId: 8, parcelNumber: 1, automaticTracking: true, lastCheckedAt: null, outcome: null, recipient: 'must not escape' }],
      history: [],
    });
    expect(JSON.stringify(result)).not.toContain('must not escape');
    expect(result.parcels[0].id).toBe(9);
  });
});
