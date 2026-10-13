import { describe, expect, it } from 'vitest';
import {
  BUSINESS_FEATURES,
  emptyBusinessFeatureFlags,
  isBusinessFeatureKey,
} from '@/lib/businessFeatures';

describe('business feature registry', () => {
  it('defaults every registered feature to disabled', () => {
    expect(emptyBusinessFeatureFlags()).toEqual({ 'foresight.marketing': false, 'ims.ai-helper': false });
  });

  it('recognizes only registered feature keys', () => {
    expect(isBusinessFeatureKey('foresight.marketing')).toBe(true);
    expect(isBusinessFeatureKey('ims.ai-helper')).toBe(true);
    expect(isBusinessFeatureKey('foresight.unreleased')).toBe(false);
  });

  it('marks both IMS automation rollouts as test features', () => {
    expect(BUSINESS_FEATURES).toEqual([
      expect.objectContaining({ key: 'foresight.marketing', product: 'IMS', testOnly: true, label: 'Marketing Activities (Test)' }),
      expect.objectContaining({ key: 'ims.ai-helper', product: 'IMS', testOnly: true, label: 'AI Helper (Test)' }),
    ]);
  });
});
