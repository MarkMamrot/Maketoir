import { afterEach, describe, expect, it } from 'vitest';

import { signOpeningStockSnapshot, verifyOpeningStockSnapshot } from '../shopifyOpeningStockSnapshot';

const originalEncryptionKey = process.env.ENCRYPTION_KEY;

describe('Shopify opening stock snapshots', () => {
  afterEach(() => { process.env.ENCRYPTION_KEY = originalEncryptionKey; });

  it('round-trips a signed tenant-scoped snapshot', () => {
    process.env.ENCRYPTION_KEY = 'test-signing-key';
    const snapshot = {
      version: 2 as const,
      businessId: 'business-1',
      channelInstanceId: 'store-1',
      offset: 10,
      expiresAt: 2_000,
      lines: [
        { variantId: 'v1', inventoryItemId: '100', locationName: 'Store', solvantisLocationId: 1, quantity: 8, wasNegative: false },
      ],
    };

    expect(verifyOpeningStockSnapshot(signOpeningStockSnapshot(snapshot), 'business-1', 'store-1', 1_000)).toEqual(snapshot);
  });

  it('rejects tampering, another tenant, and expired previews', () => {
    process.env.ENCRYPTION_KEY = 'test-signing-key';
    const token = signOpeningStockSnapshot({
      version: 2,
      businessId: 'business-1',
      channelInstanceId: 'store-1',
      offset: 0,
      expiresAt: 2_000,
      lines: [
        { variantId: 'v1', inventoryItemId: '100', locationName: 'Warehouse', solvantisLocationId: 1, quantity: 8, wasNegative: false },
        { variantId: 'v1', inventoryItemId: '100', locationName: 'Kotara', solvantisLocationId: 2, quantity: 3, wasNegative: false },
      ],
    });

    expect(() => verifyOpeningStockSnapshot(`${token}x`, 'business-1', 'store-1', 1_000)).toThrow('invalid');
    expect(() => verifyOpeningStockSnapshot(token, 'business-2', 'store-1', 1_000)).toThrow('does not belong');
    expect(() => verifyOpeningStockSnapshot(token, 'business-1', 'store-2', 1_000)).toThrow('does not belong');
    expect(() => verifyOpeningStockSnapshot(token, 'business-1', 'store-1', 2_001)).toThrow('expired');
  });

  it('rejects malformed line collections', () => {
    process.env.ENCRYPTION_KEY = 'test-signing-key';
    expect(() => signOpeningStockSnapshot({
      version: 2,
      businessId: 'business-1',
      channelInstanceId: 'store-1',
      offset: 0,
      expiresAt: 2_000,
      lines: null as never,
    })).toThrow('invalid');
  });
});