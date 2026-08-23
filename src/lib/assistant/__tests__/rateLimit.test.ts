import { beforeEach, describe, expect, it } from 'vitest';

import { checkAssistantRateLimit, clearAssistantRateLimitsForTests } from '../rateLimit';

describe('assistant rate limit', () => {
  beforeEach(clearAssistantRateLimitsForTests);

  it('allows twelve requests per actor and returns a retry delay after that', () => {
    for (let index = 0; index < 12; index += 1) {
      expect(checkAssistantRateLimit('biz:user:1', 1_000).allowed).toBe(true);
    }
    expect(checkAssistantRateLimit('biz:user:1', 1_000)).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it('uses independent actor buckets and resets after one minute', () => {
    for (let index = 0; index < 13; index += 1) checkAssistantRateLimit('biz:user:1', 1_000);
    expect(checkAssistantRateLimit('biz:user:2', 1_000).allowed).toBe(true);
    expect(checkAssistantRateLimit('biz:user:1', 61_000).allowed).toBe(true);
  });
});