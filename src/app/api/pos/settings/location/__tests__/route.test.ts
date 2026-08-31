import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getImsSession: vi.fn(),
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => name === 'marketoir_session'
      ? { value: JSON.stringify({ businessId: 'business-1', tier: 'Admin' }) }
      : undefined,
  }),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mocks.imsQuery,
  imsExecute: mocks.imsExecute,
}));

import { GET, PUT } from '../route';

describe('/api/pos/settings/location', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImsSession.mockResolvedValue({ businessId: 'business-1' });
    mocks.imsQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM ims_locations')) return Promise.resolve([{ business_id: 'business-1' }]);
      return Promise.resolve([{ value: JSON.stringify({ theme: 'classic' }) }]);
    });
    mocks.imsExecute.mockResolvedValue(undefined);
  });

  it('defaults older location settings to the IMS business product view', async () => {
    const response = await GET(new Request('http://localhost/api/pos/settings/location?location_id=7'));
    const body = await response.json();

    expect(body.settings).toMatchObject({ theme: 'classic', defaultProductView: null });
    expect(mocks.imsQuery).toHaveBeenCalledWith(
      expect.stringContaining('id = ? AND business_id = ?'),
      [7, 'business-1'],
    );
  });

  it('persists a validated product view override for the requested location', async () => {
    const response = await PUT(new Request('http://localhost/api/pos/settings/location', {
      method: 'PUT',
      body: JSON.stringify({ location_id: 7, defaultProductView: 'brand: Acme ' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.defaultProductView).toBe('brand:Acme');
    expect(mocks.imsExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_settings'),
      ['business-1', 'pos_location_settings_7', expect.any(String)],
    );
    const savedJson = mocks.imsExecute.mock.calls[0][1][2];
    expect(JSON.parse(savedJson).defaultProductView).toBe('brand:Acme');
  });
});
