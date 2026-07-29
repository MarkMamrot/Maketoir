import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockRunIms, mockTimeZone, mockGenerate } = vi.hoisted(() => ({
  mockQuery: vi.fn(), mockRunIms: vi.fn(), mockTimeZone: vi.fn(), mockGenerate: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({ query: mockQuery }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunIms }));
vi.mock('@/lib/ims/businessTimeZone', () => ({
  DEFAULT_BUSINESS_TIME_ZONE: 'Australia/Sydney', getBusinessTimeZone: mockTimeZone,
}));
vi.mock('@/lib/foresight/ForesightDigestService', () => ({
  ForesightDigestService: { generateDaily: mockGenerate },
}));

import { POST } from '../route';

function request(secret?: string): Request {
  return new Request('http://localhost/api/foresight/digests/cron', {
    method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {},
  });
}

describe('POST /api/foresight/digests/cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
    mockQuery.mockResolvedValue([{ business_id: 'business-1' }, { business_id: 'business-2' }]);
    mockRunIms.mockImplementation(async (_businessId, callback) => callback());
    mockTimeZone.mockResolvedValue('Australia/Sydney');
    mockGenerate.mockResolvedValue({ counts: { total: 1 } });
  });

  it('rejects missing or invalid cron credentials', async () => {
    expect((await POST(request())).status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('isolates tenant contexts and continues after one business fails', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({ counts: { total: 3 } });
    const response = await POST(request('test-secret'));
    const body = await response.json();
    expect(response.status).toBe(207);
    expect(mockRunIms.mock.calls.map((call) => call[0])).toEqual(['business-1', 'business-2']);
    expect(mockGenerate.mock.calls.map((call) => call[0])).toEqual(['business-1', 'business-2']);
    expect(body).toMatchObject({ businesses: 2, generated: 1, failed: 1 });
  });
});