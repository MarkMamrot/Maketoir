import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  guard: vi.fn(),
  imsExecute: vi.fn(),
  credentials: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/builds/cin7StockOverwriteGuard', () => ({
  assertCin7StockOverwriteAllowed: mocks.guard,
}));
vi.mock('@/services/IMSMySQLService', () => ({
  imsExecute: mocks.imsExecute,
  imsQuery: vi.fn(),
}));
vi.mock('@/lib/cin7Helpers', () => ({
  getCin7Credentials: mocks.credentials,
  cin7FetchAllPages: vi.fn(),
  cin7ForEachPage: vi.fn(),
}));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: vi.fn() }));

import { POST } from '../route';

describe('POST IMS sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.credentials.mockResolvedValue({ authHeader: 'test' });
  });

  it('blocks a full product replacement before any IMS mutation when stock overwrite is unsafe', async () => {
    mocks.guard.mockRejectedValue(new Error('FIFO stock replacement is blocked.'));

    const response = await POST(new Request('http://localhost/api/ims/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sync_type: 'full', steps: ['products'] }),
    }));
    const events = await response.text();

    expect(events).toContain('"status":"error"');
    expect(events).toContain('FIFO stock replacement is blocked.');
    expect(mocks.guard).toHaveBeenCalledWith('biz-1');
    expect(mocks.imsExecute).not.toHaveBeenCalled();
  });
});