import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('@/services/MySQLService', () => mocks);

import { KlaviyoSettingsRepository } from '../settingsRepository';

describe('KlaviyoSettingsRepository', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.execute.mockReset();
  });

  it('fails closed when no settings row exists', async () => {
    mocks.query.mockResolvedValue([]);

    await expect(KlaviyoSettingsRepository.get('business-1')).resolves.toEqual({
      enabled: false,
      profilesEnabled: false,
      reportingEnabled: false,
      sources: { pos: false, nativeShop: false, wholesale: false, shopify: false },
      shopifyDuplicateRiskAcknowledged: false,
    });
  });

  it('maps persisted source switches', async () => {
    mocks.query.mockResolvedValue([{
      enabled: 1,
      profiles_enabled: 1,
      reporting_enabled: 1,
      pos_enabled: 1,
      native_shop_enabled: 1,
      wholesale_enabled: 0,
      shopify_enabled: 0,
      shopify_duplicate_risk_acknowledged: 0,
    }]);

    await expect(KlaviyoSettingsRepository.get('business-1')).resolves.toMatchObject({
      enabled: true,
      sources: { pos: true, nativeShop: true, wholesale: false, shopify: false },
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE business_id = ?'), ['business-1']);
  });

  it('lists only businesses eligible for automatic processing', async () => {
    mocks.query.mockResolvedValue([{ business_id: 'business-1' }, { business_id: 'business-2' }]);

    await expect(KlaviyoSettingsRepository.listEnabledBusinessIds()).resolves.toEqual(['business-1', 'business-2']);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('business.automation_paused'));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('settings.profiles_enabled = 1'));
  });

  it('blocks Shopify events until duplicate risk is acknowledged', async () => {
    await expect(KlaviyoSettingsRepository.save('business-1', {
      enabled: true,
      profilesEnabled: true,
      reportingEnabled: true,
      sources: { pos: true, nativeShop: true, wholesale: true, shopify: true },
      shopifyDuplicateRiskAcknowledged: false,
    })).rejects.toThrow('acknowledgement of duplicate-event risk');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});