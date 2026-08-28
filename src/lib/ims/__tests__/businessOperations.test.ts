import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertXeroAccountingEnabled,
  isXeroAccountingEnabled,
  resolveXeroAccountingEnabled,
  XeroAccountingDisabledError,
} from '../businessOperations';

const mocks = vi.hoisted(() => ({
  getImsDbNameStrict: vi.fn(),
  imsQuery: vi.fn(),
}));

vi.mock('@/lib/db/BusinessRegistry', () => ({
  getImsDbNameStrict: mocks.getImsDbNameStrict,
}));

vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mocks.imsQuery,
}));

describe('business operation capabilities', () => {
  beforeEach(() => {
    mocks.getImsDbNameStrict.mockReset();
    mocks.imsQuery.mockReset();
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
});