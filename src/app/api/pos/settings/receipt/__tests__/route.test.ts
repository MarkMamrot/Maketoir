import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getImsSession: vi.fn(),
  imsQuery: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET } from '../route';

function cookieStore(values: Record<string, string>) {
  return { get: (name: string) => values[name] ? { value: values[name] } : undefined };
}

describe('GET POS receipt settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockReturnValue(cookieStore({
      pos_session: JSON.stringify({ businessId: 'biz-1', location_id: 4 }),
    }));
    mocks.getImsSession.mockResolvedValue({ businessId: 'biz-1' });
    mocks.reportRuntimeIssue.mockResolvedValue(undefined);
  });

  it('returns the location footer over the business footer', async () => {
    mocks.imsQuery
      .mockResolvedValueOnce([
        { key: 'business_name', value: 'Shop' },
        { key: 'pos_receipt_footer', value: 'Business footer' },
      ])
      .mockResolvedValueOnce([{ address: '1 Main St', city: 'Sydney', state: 'NSW', postcode: '2000', phone: null }])
      .mockResolvedValueOnce([{ value: JSON.stringify({ receiptFooter: 'Location footer' }) }]);

    const response = await GET(new Request('http://localhost/api/pos/settings/receipt?location_id=4'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pos_receipt_footer).toBe('Location footer');
  });

  it('returns an error instead of a blank successful footer when loading fails', async () => {
    mocks.imsQuery.mockRejectedValue(new Error('database unavailable'));

    const response = await GET(new Request('http://localhost/api/pos/settings/receipt?location_id=4'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Receipt settings could not be loaded.');
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      source: 'pos.receipt_settings',
      operation: 'load',
    }));
  });
});
