import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockRunIms, mockTimeZone, mockGenerate, mockGenerateWeekly, mockEvaluateOutcomes } = vi.hoisted(() => ({
  mockQuery: vi.fn(), mockRunIms: vi.fn(), mockTimeZone: vi.fn(), mockGenerate: vi.fn(), mockGenerateWeekly: vi.fn(), mockEvaluateOutcomes: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({ query: mockQuery }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunIms }));
vi.mock('@/lib/ims/businessTimeZone', () => ({
  DEFAULT_BUSINESS_TIME_ZONE: 'Australia/Sydney', getBusinessTimeZone: mockTimeZone,
}));
vi.mock('@/lib/foresight/ForesightDigestService', () => ({
  ForesightDigestService: { generateDaily: mockGenerate, generateWeekly: mockGenerateWeekly },
}));
vi.mock('@/lib/foresight/ForesightOutcomeService', () => ({
  ForesightOutcomeService: { evaluateDuePaidMedia: mockEvaluateOutcomes },
}));

import { POST } from '../route';

function request(secret?: string, body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/foresight/digests/cron', {
    method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {},
    body: body ? JSON.stringify(body) : undefined,
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
    mockGenerateWeekly.mockResolvedValue({ notices: [] });
    mockEvaluateOutcomes.mockResolvedValue({ measuredCount: 0, deferredCount: 0 });
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
    expect(mockRunIms.mock.calls.map((call) => call[0])).toEqual([
      'business-1', 'business-1', 'business-2', 'business-2',
    ]);
    expect(mockGenerate.mock.calls.map((call) => call[0])).toEqual(['business-1', 'business-2']);
    expect(body).toMatchObject({ businesses: 2, generated: 1, failed: 1 });
  });

  it('evaluates due outcomes through each tenant yesterday before the daily digest', async () => {
    mockEvaluateOutcomes.mockResolvedValueOnce({ measuredCount: 1, deferredCount: 0 });

    const response = await POST(request('test-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockEvaluateOutcomes).toHaveBeenCalledTimes(2);
    expect(mockEvaluateOutcomes.mock.calls[0]).toEqual(['business-1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]);
    expect(body.results[0]).toMatchObject({ measuredOutcomes: 1, deferredOutcomes: 0 });
  });

  it('generates weekly summaries separately through each business yesterday', async () => {
    const response = await POST(request('test-secret', { digestType: 'weekly_summary' }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mockGenerateWeekly.mock.calls.map((call) => call[0])).toEqual(['business-1', 'business-2']);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockEvaluateOutcomes).not.toHaveBeenCalled();
    expect(body).toMatchObject({ digestType: 'weekly_summary', generated: 2 });
  });
});