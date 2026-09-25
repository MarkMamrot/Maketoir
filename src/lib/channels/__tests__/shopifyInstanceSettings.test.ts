import { describe, expect, it } from 'vitest';

import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';

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
        dailyAutoSyncEnabled: false, onlineBatchAction: 'none', paymentSyncEnabled: false,
        payoutPostingEnabled: false, payoutAutoPostEnabled: false,
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
        dailyAutoSyncEnabled: true, onlineBatchAction: 'authorised', paymentSyncEnabled: 1,
        payoutPostingEnabled: true, payoutAutoPostEnabled: '1',
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
        dailyAutoSyncEnabled: true, onlineBatchAction: 'authorised', paymentSyncEnabled: true,
        payoutPostingEnabled: true, payoutAutoPostEnabled: true,
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
});