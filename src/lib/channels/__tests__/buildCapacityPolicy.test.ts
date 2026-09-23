import { describe, expect, it } from 'vitest';

import {
  normalizeChannelInventoryLocationIds,
  resolveChannelBuildCapacityPolicy,
} from '../buildCapacityPolicy';

describe('channel Build Capacity policy', () => {
  it('defaults off and uses fallback locations', () => {
    expect(resolveChannelBuildCapacityPolicy({}, [2, 1, 2])).toEqual({
      enabled: false,
      inventoryLocationIds: [2, 1],
    });
  });

  it('uses exact channel settings when configured', () => {
    expect(resolveChannelBuildCapacityPolicy({
      buildCapacityEnabled: 1,
      inventoryLocationIds: [7, 3],
    }, [2])).toEqual({
      enabled: true,
      inventoryLocationIds: [7, 3],
    });
  });

  it('rejects invalid channel inventory locations', () => {
    expect(() => normalizeChannelInventoryLocationIds([1, 0])).toThrow(/valid location IDs/);
    expect(() => normalizeChannelInventoryLocationIds(['not-a-location'])).toThrow(/valid location IDs/);
  });
});