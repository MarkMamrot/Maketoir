import { describe, expect, it } from 'vitest';
import {
  BUSINESS_FEATURES,
  emptyBusinessFeatureFlags,
  isBusinessFeatureKey,
} from '@/lib/businessFeatures';

describe('business feature registry', () => {
  it('defaults every registered feature to disabled', () => {
    expect(emptyBusinessFeatureFlags()).toEqual({ 'foresight.marketing': false });
  });

  it('recognizes only registered feature keys', () => {
    expect(isBusinessFeatureKey('foresight.marketing')).toBe(true);
    expect(isBusinessFeatureKey('foresight.unreleased')).toBe(false);
  });

  it('keeps the initial Marketing rollout in the Foresight product', () => {
    expect(BUSINESS_FEATURES[0]).toMatchObject({ key: 'foresight.marketing', product: 'Foresight' });
  });
});
