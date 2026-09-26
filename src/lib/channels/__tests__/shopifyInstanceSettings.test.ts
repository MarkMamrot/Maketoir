import { describe, expect, it } from 'vitest';

import { mergeShopifyInstanceSettings, shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';

describe('shopifyInstanceSettings', () => {
  it('defaults all provider mutations and outbound sync off', () => {
    expect(shopifyInstanceSettings({})).toEqual({
      orders: { enabled: false, syncFrom: null, lastUpdatedAt: null, locationId: null },
      inventory: {
        enabled: false, buffer: 0, intervalMinutes: 15, locationId: null, pickLocationIds: [], lastRunAt: null,
      },
      customers: { outboundEnabled: false },
      giftCards: { mode: 'off' },
      xero: {
        dailyAutoSyncEnabled: false, payoutPostingEnabled: false, payoutAutoPostEnabled: false,
      },
    });
  });

  it('normalizes valid nested exact-instance settings', () => {
    expect(shopifyInstanceSettings({ shopify: {
      orders: { enabled: 1, syncFrom: ' 2026-09-01 ', lastUpdatedAt: '2026-09-25T00:00:00Z', locationId: '7' },
      inventory: {
        enabled: '1', buffer: '3', intervalMinutes: '30', locationId: 44,
        pickLocationIds: [7, '8', 7, 0, 'bad'], lastRunAt: '2026-09-25T01:00:00Z',
      },
      customers: { outboundEnabled: true },
      giftCards: { mode: 'combined' },
      xero: {
        dailyAutoSyncEnabled: true, payoutPostingEnabled: true, payoutAutoPostEnabled: '1',
      },
    } })).toEqual({
      orders: { enabled: true, syncFrom: '2026-09-01', lastUpdatedAt: '2026-09-25T00:00:00Z', locationId: 7 },
      inventory: {
        enabled: true, buffer: 3, intervalMinutes: 30, locationId: 44,
        pickLocationIds: [7, 8], lastRunAt: '2026-09-25T01:00:00Z',
      },
      customers: { outboundEnabled: true },
      giftCards: { mode: 'combined' },
      xero: {
        dailyAutoSyncEnabled: true, payoutPostingEnabled: true, payoutAutoPostEnabled: true,
      },
    });
  });

  it('fails closed for malformed and unsupported values', () => {
    expect(shopifyInstanceSettings({ shopify: {
      orders: { enabled: 'true', locationId: -1 },
      inventory: { enabled: {}, buffer: -2, intervalMinutes: 0, pickLocationIds: '7,8' },
      customers: { outboundEnabled: 'yes' },
      giftCards: { mode: 'global' },
    } })).toMatchObject({
      orders: { enabled: false, locationId: null },
      inventory: { enabled: false, buffer: 0, intervalMinutes: 15, pickLocationIds: [] },
      customers: { outboundEnabled: false },
      giftCards: { mode: 'off' },
    });
  });

  it('merges a validated partial update without resetting other groups', () => {
    const current = { shopify: {
      orders: { enabled: true, syncFrom: '2026-09-01', locationId: 7 },
      inventory: { enabled: true, buffer: 2, intervalMinutes: 30, pickLocationIds: [7] },
      giftCards: { mode: 'off' },
      xero: { payoutPostingEnabled: true },
    } };

    expect(mergeShopifyInstanceSettings(current, {
      inventory: { buffer: 5, pickLocationIds: [7, 8] },
      giftCards: { mode: 'combined' },
    })).toMatchObject({
      orders: { enabled: true, syncFrom: '2026-09-01', locationId: 7 },
      inventory: { enabled: true, buffer: 5, intervalMinutes: 30, pickLocationIds: [7, 8] },
      giftCards: { mode: 'combined' },
      xero: { payoutPostingEnabled: true },
    });
  });

  it('rejects invalid writes and inconsistent payout automation', () => {
    expect(() => mergeShopifyInstanceSettings({}, { inventory: { intervalMinutes: 0 } }))
      .toThrow('Inventory interval must be a positive whole number.');
    expect(() => mergeShopifyInstanceSettings({}, { giftCards: { mode: 'invalid' as 'off' } }))
      .toThrow('Gift-card mode must be off or combined.');
    expect(() => mergeShopifyInstanceSettings({}, { xero: { payoutAutoPostEnabled: true } }))
      .toThrow('Automatic payout posting requires payout posting to be enabled.');
  });
});