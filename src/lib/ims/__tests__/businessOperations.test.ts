import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertXeroAccountingEnabled,
  assertNativeShopEnabled,
  assertShopifyEnabled,
  getOnlineChannelCapabilities,
  isXeroAccountingEnabled,
  OnlineChannelDisabledError,
  resolveXeroAccountingEnabled,
  XeroAccountingDisabledError,
} from '../businessOperations';

const mocks = vi.hoisted(() => ({
  getImsDbNameStrict: vi.fn(),
  getCapabilities: vi.fn(),
  imsQuery: vi.fn(),
}));

vi.mock('@/lib/db/BusinessRegistry', () => ({
  getImsDbNameStrict: mocks.getImsDbNameStrict,
}));

vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mocks.imsQuery,
}));

vi.mock('@/lib/onlineShop/onlineShopProfile', () => ({
  OnlineSalesChannelRepository: { getCapabilities: mocks.getCapabilities },
}));

describe('business operation capabilities', () => {
  beforeEach(() => {
    mocks.getImsDbNameStrict.mockReset();
    mocks.imsQuery.mockReset();
    mocks.getCapabilities.mockReset();
    mocks.getImsDbNameStrict.mockResolvedValue('tenant_ims');
  });

  it.each([
    [{ connect_accounting_software: 'yes', accounting_software: 'xero' }, true],
    [{ connect_accounting_software: 'no', accounting_software: 'xero' }, false],
    [{ accounting_software: 'xero' }, false],
    [{ connect_accounting_software: 'yes', accounting_software: 'quickbooks' }, false],
  ])('resolves Xero accounting from business settings', (settings, expected) => {
    expect(resolveXeroAccountingEnabled(settings)).toBe(expected);
  });

  it('reads settings from the explicitly resolved tenant schema', async () => {
    mocks.imsQuery.mockResolvedValue([
      { key: 'connect_accounting_software', value: 'yes' },
      { key: 'accounting_software', value: 'xero' },
    ]);

    await expect(isXeroAccountingEnabled('biz-1')).resolves.toBe(true);
    expect(mocks.imsQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM ims_settings'),
      ['biz-1', 'connect_accounting_software', 'accounting_software'],
      'tenant_ims',
    );
  });

  it('fails closed when the accounting setting is missing', async () => {
    mocks.imsQuery.mockResolvedValue([{ key: 'accounting_software', value: 'xero' }]);

    await expect(assertXeroAccountingEnabled('biz-1')).rejects.toBeInstanceOf(XeroAccountingDisabledError);
  });

  it('returns independent online channel capabilities', async () => {
    mocks.getCapabilities.mockResolvedValue({ shopifyEnabled: true, nativeShopEnabled: true });
    await expect(getOnlineChannelCapabilities('biz-1')).resolves.toEqual({ shopifyEnabled: true, nativeShopEnabled: true });
  });

  it('fails closed for an empty business id', async () => {
    await expect(getOnlineChannelCapabilities('')).resolves.toEqual({ shopifyEnabled: false, nativeShopEnabled: false });
    expect(mocks.getCapabilities).not.toHaveBeenCalled();
  });

  it('asserts each online channel independently', async () => {
    mocks.getCapabilities.mockResolvedValue({ shopifyEnabled: false, nativeShopEnabled: true });
    await expect(assertNativeShopEnabled('biz-1')).resolves.toBeUndefined();
    await expect(assertShopifyEnabled('biz-1')).rejects.toMatchObject<Partial<OnlineChannelDisabledError>>({
      code: 'shopify_disabled', status: 403,
    });
  });
});