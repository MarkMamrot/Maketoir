import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecute, mockQuery } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ execute: mockExecute, query: mockQuery }));

import {
  normalizeOnlineShopSlug,
  OnlineSalesChannelRepository,
  OnlineShopProfileRepository,
  validateOnlineShopSlug,
} from '../onlineShopProfile';

describe('online shop profile control plane', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockQuery.mockReset();
  });

  it('normalizes public shop slugs and rejects reserved routes', () => {
    expect(normalizeOnlineShopSlug('  Café & Home  ')).toBe('cafe-home');
    expect(() => validateOnlineShopSlug('checkout')).toThrow('reserved');
    expect(() => validateOnlineShopSlug('ab')).toThrow('at least 3');
  });

  it('defaults missing or unknown channel state to none', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ active_channel: 'other' }]);
    await expect(OnlineSalesChannelRepository.get('business-1')).resolves.toBe('none');
    await expect(OnlineSalesChannelRepository.get('business-1')).resolves.toBe('none');
  });

  it('resolves Shopify and native capabilities independently with legacy fallback', async () => {
    mockQuery.mockResolvedValueOnce([{ active_channel: 'shopify', shopify_enabled: 0, native_shop_enabled: 1 }]);
    await expect(OnlineSalesChannelRepository.getCapabilities('business-1')).resolves.toEqual({
      shopifyEnabled: true,
      nativeShopEnabled: true,
    });
  });

  it('persists independent online channel capabilities', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    await OnlineSalesChannelRepository.setCapabilities({
      businessId: 'business-1', shopifyEnabled: true, nativeShopEnabled: true, actorUserId: 7, actorName: 'Admin',
    });
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('ON DUPLICATE KEY UPDATE'),
      ['business-1', 'none', 1, 1, 7, 'Admin'],
    );
  });

  it('requires the native channel when resolving a public active profile', async () => {
    mockQuery.mockResolvedValue([{ business_id: 'business-1', slug: 'shop-one', display_name: 'Shop One',
      logo_url: null, support_email: 'help@example.com', default_meta_title: null,
      default_meta_description: null, is_active: 1 }]);
    await expect(OnlineShopProfileRepository.getActiveBySlug('Shop One')).resolves.toMatchObject({
      businessId: 'business-1', slug: 'shop-one', isActive: true,
    });
    expect(mockQuery.mock.calls[0][0]).toContain('c.native_shop_enabled = 1');
  });

  it('creates inactive profiles unless activation is explicit', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    await OnlineShopProfileRepository.upsert({ businessId: 'business-1', slug: 'shop-one', displayName: 'Shop One' });
    expect(mockExecute.mock.calls[0][1]).toEqual([
      'business-1', 'shop-one', 'Shop One', null, null, null, null, 0,
    ]);
  });
});