import { describe, expect, it } from 'vitest';
import { parseOnlineSyncWorkPayload } from '../onlineSyncPayload';

describe('online recovery ID-only payloads', () => {
  it.each([
    { kind: 'order_snapshot', orderId: '123' },
    { kind: 'order_effects', orderId: '123', updatedAt: '2026-10-17T00:00:00Z', hash: 'a'.repeat(64), refundIds: ['456'], paid: true },
    { kind: 'daily_accounting', date: '2026-10-16' },
    { kind: 'gift_cards', continuation: null },
    { kind: 'daily_accounting', date: '2026-10-16', manual: true, blockedReason: 'accounting_review_required' },
  ])('round trips $kind without persisting unknown/private fields', payload => {
    expect(parseOnlineSyncWorkPayload({ ...payload, customer: { email: 'not-persisted' } })).toEqual(payload);
  });
  it.each([
    null, [], { kind: 'order_snapshot', orderId: '../123' },
    { kind: 'daily_accounting', date: '2026-02-30' },
    { kind: 'gift_cards', continuation: { pageInfo: 'https://untrusted.test' } },
    { kind: 'daily_accounting', date: '2026-10-16', manual: false },
    { kind: 'gift_cards', continuation: null, blockedReason: 'private customer@example.com' },
    { kind: 'order_effects', orderId: '123', updatedAt: '2026-10-17T00:00:00Z', hash: 'a'.repeat(64), refundIds: ['456', '456'], paid: true },
  ])('rejects invalid persisted work %#', payload => {
    expect(() => parseOnlineSyncWorkPayload(payload)).toThrow();
  });
});
