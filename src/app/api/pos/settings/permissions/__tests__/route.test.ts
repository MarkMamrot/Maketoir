import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getImsSession: vi.fn(),
  imsQuery: vi.fn(),
  control: vi.fn(),
}));
vi.mock('@/lib/channels/onlineSyncControl', () => ({ getOnlineSyncControl: mocks.control }));
vi.mock('@/lib/db/BusinessRegistry', () => ({
  runImsForBusiness: (_id: string, callback: () => Promise<unknown>) => callback(),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => name === 'pos_session'
      ? { value: JSON.stringify({ businessId: 'business-1' }) }
      : undefined,
  }),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));

import { GET } from '../route';

describe('/api/pos/settings/permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.control.mockResolvedValue({ mode: 'legacy' });
    mocks.getImsSession.mockResolvedValue({ businessId: 'business-1' });
    mocks.imsQuery.mockResolvedValue([]);
  });

  it('fails closed when accounting settings are absent', async () => {
    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      bt_access: 'all',
      xeroAccountingEnabled: false,
      onlineSalesStartupEnabled: true,
    });
  });

  it('returns Xero enabled only when both operation settings enable it', async () => {
    mocks.imsQuery.mockResolvedValue([
      { key: 'pos_bt_access', value: 'manager' },
      { key: 'connect_accounting_software', value: 'yes' },
      { key: 'accounting_software', value: 'xero' },
    ]);

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      bt_access: 'manager',
      xeroAccountingEnabled: true,
      onlineSalesStartupEnabled: true,
    });
    expect(mocks.imsQuery).toHaveBeenCalledWith(expect.stringContaining('connect_accounting_software'), ['business-1']);
  });
  it('suppresses browser accounting at cutover without disabling Xero functionality', async () => {
    mocks.control.mockResolvedValue({ mode: 'cutover' });
    mocks.imsQuery.mockResolvedValue([
      { key: 'connect_accounting_software', value: 'yes' }, { key: 'accounting_software', value: 'xero' },
    ]);
    expect(await (await GET()).json()).toMatchObject({
      xeroAccountingEnabled: true, onlineSalesStartupEnabled: false,
    });
  });
});