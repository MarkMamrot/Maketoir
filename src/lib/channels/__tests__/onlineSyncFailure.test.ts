import { describe, expect, it } from 'vitest';
import { classifyOnlineSyncFailure } from '../onlineSyncFailure';
import { OnlineSyncValidationError } from '../onlineSyncPolicy';
describe('safe online recovery failure classification', () => {
  it('respects provider Retry-After even beyond normal exponential-backoff limits', () => {
    expect(classifyOnlineSyncFailure({ statusCode: 429, response: { headers: { 'retry-after': '7200' } } }))
      .toEqual({ code: 'provider_rate_limit', retryAfterSeconds: 7200, providerStatus: 429 });
  });
  it('handles HTTP date retry bounds', () => {
    expect(classifyOnlineSyncFailure({ response: { statusCode: 503, headers: { 'retry-after': 'Sat, 17 Oct 2026 00:02:00 GMT' } } },
      Date.parse('2026-10-17T00:00:00Z')).retryAfterSeconds).toBe(120);
  });
  it('retains explicit restricted-history failure rather than marking an empty baseline', () => {
    expect(classifyOnlineSyncFailure(new OnlineSyncValidationError('Shopify read_all_orders access is required.')).code)
      .toBe('history_unavailable');
  });
  it('does not persist provider bodies, credentials or raw errors', () => {
    const result = classifyOnlineSyncFailure({ message: 'private', response: { body: { customer: 'private' } } });
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
