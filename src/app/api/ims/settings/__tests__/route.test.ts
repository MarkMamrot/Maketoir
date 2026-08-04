import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetImsSession, mockImsQuery, mockImsExecute, mockGetConnection } = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
  mockGetConnection: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery, imsExecute: mockImsExecute }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: mockGetConnection },
}));

import { GET, PUT } from '../route';

function putRequest(settings: Record<string, string>): Request {
  return new Request('http://localhost/api/ims/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
}

describe('/api/ims/settings loyalty settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1' });
    mockImsQuery.mockResolvedValue([]);
    mockImsExecute.mockResolvedValue({ affectedRows: 1 });
    mockGetConnection.mockResolvedValue(null);
  });

  it('returns loyalty switched off when the tenant has no loyalty settings', async () => {
    const response = await GET();
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      loyalty_enabled: '0',
      loyalty_earn_rate: '1',
      loyalty_program_name: 'Rewards Program',
      loyalty_points_label: 'Points',
      loyalty_started_at: '',
    });
  });

  it.each([
    [{ loyalty_enabled: 'yes' }, 'Loyalty enabled'],
    [{ loyalty_earn_rate: '0' }, 'Loyalty earn rate'],
    [{ loyalty_started_at: '2026-02-31' }, 'Loyalty start date'],
  ])('rejects invalid loyalty settings before writing: %o', async (settings, errorText) => {
    const response = await PUT(putRequest(settings));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain(errorText);
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('persists a valid disabled configuration without enabling loyalty', async () => {
    const response = await PUT(putRequest({
      loyalty_enabled: '0',
      loyalty_earn_rate: '1.5',
      loyalty_program_name: 'Club Rewards',
      loyalty_points_label: 'Stars',
      loyalty_started_at: '',
    }));

    expect(response.status).toBe(200);
    expect(mockImsExecute).toHaveBeenCalledTimes(5);
    expect(mockImsExecute.mock.calls[0][1]).toEqual(['business-1', 'loyalty_enabled', '0']);
  });
});