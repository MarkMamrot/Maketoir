import { describe, expect, it } from 'vitest';
import { AMAZON_PII_SOURCES, amazonPiiOrderNeedsPriorityReview, validateAmazonPiiInventoryReport } from '../amazonPiiInventory';

function report() {
  return {
    mode: 'read-only', generatedAt: '2026-10-15T00:00:00.000Z',
    summary: { amazonOrders: 1, ordersWithPotentialPii: 1, ordersWithStructuredFields: 1,
      ordersWithUnreviewedContent: 0, agedOrdersNeedingReview: 1, confirmedOverdue: null },
    deliveryEvidence: { availability: 'available', ordersWithVerifiedDelivery: 0, ordersPastReviewDeadline: 0 },
    sources: AMAZON_PII_SOURCES.map(source => ({ id: source.id, availability: 'available', records: 1 })),
    orders: [{ salesOrderId: 42, amazonOrderReference: '123-1234567-1234567', orderDate: '2026-09-15', ageDays: 30, sourceIds: ['order-address'],
      earliestVerifiedDeliveryAt: null, reviewDeadlineAt: null }],
    afterId: 0, nextAfterId: null,
  };
}

describe('read-only Amazon PII inventory contract', () => {
  it('accepts evidence-based review deadlines without claiming confirmed PII or disposal', () => {
    const value = report();
    const result = validateAmazonPiiInventoryReport({
      ...value, deliveryEvidence: { availability: 'available', ordersWithVerifiedDelivery: 1, ordersPastReviewDeadline: 1 },
      orders: [{ ...value.orders[0], earliestVerifiedDeliveryAt: '2025-09-01T00:00:00.000Z', reviewDeadlineAt: '2025-10-01T00:00:00.000Z' }],
    });
    expect(result.summary.confirmedOverdue).toBeNull();
    expect(result.deliveryEvidence.ordersPastReviewDeadline).toBe(1);
    expect(() => validateAmazonPiiInventoryReport({ ...result, orders: [{ ...result.orders[0], reviewDeadlineAt: '2025-10-02T00:00:00.000Z' }] }))
      .toThrow('deadline');
  });
  it.each([[null, false], [0, false], [29, false], [30, true], [31, true]] as const)('uses the exact 30-day triage threshold for %s', (age, expected) => {
    expect(amazonPiiOrderNeedsPriorityReview(age)).toBe(expected);
  });

  it.each([-1, 1.5, NaN])('rejects invalid ages instead of labelling them safe', age => {
    expect(() => amazonPiiOrderNeedsPriorityReview(age)).toThrow();
  });

  it('withholds overdue conclusions and strips unapproved fields from every output level', () => {
    const value = report();
    const result = validateAmazonPiiInventoryReport({
      ...value, rawPayload: 'private buyer',
      summary: { ...value.summary, buyer: 'private buyer' },
      orders: value.orders.map(order => ({ ...order, recipient: 'private buyer' })),
    });
    expect(result.summary.confirmedOverdue).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private buyer');
    expect(result.orders[0].sourceIds).toEqual(['order-address']);
  });

  it('does not turn an unavailable source into zero', () => {
    const value = report();
    value.sources[0] = { id: 'order-address', availability: 'unavailable', records: 0 };
    expect(() => validateAmazonPiiInventoryReport(value)).toThrow('cannot have a count');
    expect(validateAmazonPiiInventoryReport({
      ...value, sources: value.sources.map((source, index) => index === 0 ? { ...source, records: null } : source),
    }).sources[0].records).toBeNull();
  });

  it.each([0, 1, 'unknown'])('never accepts a confirmed overdue number without delivery evidence (%s)', confirmedOverdue => {
    const value = report();
    expect(() => validateAmazonPiiInventoryReport({ ...value, summary: { ...value.summary, confirmedOverdue } })).toThrow('Delivery evidence');
  });

  it.each(['buyer@example.com', 'Jane Customer', '123-1234567-1234567\n'])('rejects unvalidated reference text (%s)', amazonOrderReference => {
    const value = report();
    expect(() => validateAmazonPiiInventoryReport({ ...value, orders: [{ ...value.orders[0], amazonOrderReference }] })).toThrow('reference');
  });

  it('rejects duplicate coverage and oversized pages', () => {
    const value = report();
    expect(() => validateAmazonPiiInventoryReport({ ...value, sources: value.sources.map(() => value.sources[0]) })).toThrow('Duplicate');
    expect(() => validateAmazonPiiInventoryReport({ ...value, orders: Array(26).fill(value.orders[0]) })).toThrow('coverage');
  });
});
