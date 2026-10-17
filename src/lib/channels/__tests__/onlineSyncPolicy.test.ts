import { describe, expect, it } from 'vitest';
import {
  nextOnlineSyncDue, nextReconciliationWindow, onlinePostingReadiness, onlineSyncOffsetMs,
  onlineSyncRetrySeconds, onlineSyncTimestamp, parseReconciliationContinuation, validateReconciliationWindow,
} from '../onlineSyncPolicy';

const from = '2026-07-01T00:00:00.000Z';
const now = '2026-10-17T04:00:00.000Z';
const window = { phase: 'incremental' as const, from, to: now };
const ready = {
  provider: 'shopify' as const, paused: false, baselineComplete: true,
  coveredThrough: now, requiredThrough: now, unresolvedOrderEffects: false, postedDayChanged: false,
};

describe('online sync boundaries', () => {
  it.each(['2026-10-17', '2026-02-30T00:00:00Z', 'yesterday', '', '2026-10-17T04:00:00'])('rejects invalid or timezone-less boundary %s', value => {
    expect(() => onlineSyncTimestamp(value)).toThrow();
  });
  it('normalizes explicit offsets', () => {
    expect(new Date(onlineSyncTimestamp('2026-10-17T15:00:00+11:00')).toISOString()).toBe(now);
  });
  it('starts an unverified baseline from configured history with a fixed safe upper bound', () => {
    expect(nextReconciliationWindow({ baselineFrom: from, coveredThrough: null, now })).toEqual({
      phase: 'baseline', from, to: '2026-10-17T03:58:00.000Z',
    });
  });
  it('overlaps updates rather than fetching only newly created orders', () => {
    expect(nextReconciliationWindow({ baselineFrom: from, coveredThrough: '2026-10-17T03:45:00Z', now })).toEqual({
      phase: 'incremental', from: '2026-10-17T03:40:00.000Z', to: '2026-10-17T03:58:00.000Z',
    });
  });
  it('never moves a watermark backwards or creates an empty interval', () => {
    expect(nextReconciliationWindow({ baselineFrom: from, coveredThrough: now, now })).toBeNull();
    expect(nextReconciliationWindow({ baselineFrom: now, coveredThrough: null, now })).toBeNull();
    expect(() => nextReconciliationWindow({ baselineFrom: now, coveredThrough: from, now })).toThrow();
    expect(() => validateReconciliationWindow({ ...window, from: now })).toThrow();
  });
});

describe('durable continuation validation', () => {
  const continuation = { window, pageInfo: null, remaining: [{ id: '123', updatedAt: now }], nextPageInfo: 'abc_123==', pageLoaded: true };
  it('round trips only bounded order references, not customer payloads', () => {
    expect(parseReconciliationContinuation(JSON.parse(JSON.stringify(continuation)))).toEqual(continuation);
  });
  it.each([
    null, {}, { ...continuation, pageLoaded: false }, { ...continuation, pageInfo: 'https://other.example/orders' },
    { ...continuation, remaining: Array(251).fill({ id: '123', updatedAt: now }) },
    { ...continuation, remaining: [{ id: '123', updatedAt: now }, { id: '123', updatedAt: now }] },
    { ...continuation, remaining: [{ id: '../123', updatedAt: now }] },
    { ...continuation, remaining: [{ id: '123', updatedAt: 'bad' }] },
  ])('rejects malformed state rather than skipping work', value => {
    expect(() => parseReconciliationContinuation(value)).toThrow();
  });
});

describe('fair eligibility and retries', () => {
  it('persists a deterministic owner-specific offset in the 15 minute interval', () => {
    const offset = onlineSyncOffsetMs('business', 'store');
    expect(offset).toBe(onlineSyncOffsetMs('business', 'store'));
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(900_000);
    expect(offset).not.toBe(onlineSyncOffsetMs('other-business', 'store'));
    const due = nextOnlineSyncDue(now, 'business', 'store');
    expect(Date.parse(due)).toBeGreaterThan(Date.parse(now));
    expect(Date.parse(due) - Date.parse(now)).toBeLessThanOrEqual(900_000);
    expect(Date.parse(due) % 900_000).toBe(offset);
    expect(nextOnlineSyncDue(due, 'business', 'store')).not.toBe(due);
    expect(() => onlineSyncOffsetMs('', 'store')).toThrow();
  });
  it('backs off without discarding jobs and honours a longer provider Retry-After', () => {
    expect(onlineSyncRetrySeconds(1, 0)).toBe(60);
    expect(onlineSyncRetrySeconds(2, 1)).toBe(144);
    expect(onlineSyncRetrySeconds(99, 1)).toBe(3600);
    expect(onlineSyncRetrySeconds(1, 0, 7200)).toBe(7200);
    expect(() => onlineSyncRetrySeconds(0, 0)).toThrow();
    expect(() => onlineSyncRetrySeconds(1, Number.NaN)).toThrow();
  });
});

describe('posting barriers', () => {
  it('requires verified baseline and exact coverage for Shopify', () => {
    expect(onlinePostingReadiness(ready)).toEqual({ ready: true });
    expect(onlinePostingReadiness({ ...ready, baselineComplete: false })).toMatchObject({ reason: 'baseline_incomplete' });
    expect(onlinePostingReadiness({ ...ready, coveredThrough: null })).toMatchObject({ reason: 'reconciliation_incomplete' });
    expect(onlinePostingReadiness({ ...ready, coveredThrough: from })).toMatchObject({ reason: 'reconciliation_incomplete' });
  });
  it('keeps native accounting independent of Shopify, but not pauses or unsafe effects', () => {
    expect(onlinePostingReadiness({ ...ready, provider: 'native_shop', baselineComplete: false, coveredThrough: null })).toEqual({ ready: true });
    expect(onlinePostingReadiness({ ...ready, paused: true })).toMatchObject({ reason: 'paused' });
    expect(onlinePostingReadiness({ ...ready, unresolvedOrderEffects: true })).toMatchObject({ reason: 'order_review_required' });
  });
  it('never authorises automatic correction of a changed posted day', () => {
    expect(onlinePostingReadiness({ ...ready, postedDayChanged: true })).toEqual({ ready: false, reason: 'posted_day_changed' });
  });
});
