import { describe, expect, it } from 'vitest';
import { inventoryQueueIdsToDelete, shopifyInventoryPolicyPayload, shouldRunInventorySync } from '../shopifyInventorySync';

describe('shouldRunInventorySync', () => {
  it('runs immediately when there is no previous run', () => {
    expect(shouldRunInventorySync(null, 15, new Date('2024-01-01T00:00:00.000Z'))).toBe(true);
  });

  it('runs when the configured interval has elapsed', () => {
    expect(shouldRunInventorySync('2024-01-01T00:00:00.000Z', 15, new Date('2024-01-01T00:15:00.000Z'))).toBe(true);
  });

  it('skips when the interval has not elapsed yet', () => {
    expect(shouldRunInventorySync('2024-01-01T00:00:00.000Z', 15, new Date('2024-01-01T00:14:59.000Z'))).toBe(false);
  });
});

describe('shopifyInventoryPolicyPayload', () => {
  it('tracks stock products and denies overselling', () => {
    expect(shopifyInventoryPolicyPayload(1)).toEqual({ inventory_management: 'shopify', inventory_policy: 'deny' });
  });

  it('does not manage inventory for untracked products and continues selling', () => {
    expect(shopifyInventoryPolicyPayload(0)).toEqual({ inventory_management: null, inventory_policy: 'continue' });
  });
});

describe('inventoryQueueIdsToDelete', () => {
  it('retains every item for a business whose Shopify batch failed', () => {
    const queued = [
      { variant_id: 'variant-a', business_id: 'business-1' },
      { variant_id: 'variant-b', business_id: 'business-1' },
      { variant_id: 'variant-c', business_id: 'business-2' },
    ];

    expect(inventoryQueueIdsToDelete(queued, new Set(['business-1']))).toEqual(['variant-c']);
  });
});
