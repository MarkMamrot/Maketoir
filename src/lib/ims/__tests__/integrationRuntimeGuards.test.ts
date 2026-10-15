import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  availability: vi.fn(),
  session: vi.fn(),
  sheets: vi.fn(),
  fetch: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/ims/integrationAvailability', () => ({
  isOptionalIntegrationEnabled: mocks.enabled,
  getOptionalIntegrationAvailability: mocks.availability,
  assertOptionalIntegrationEnabled: async (businessId: string, provider: string) => {
    if (!await mocks.enabled(businessId, provider)) {
      throw Object.assign(new Error('Integration disabled'), { code: 'integration_disabled', status: 423 });
    }
  },
  isIntegrationDisabledError: (error: { code?: string }) => error?.code === 'integration_disabled',
}));
vi.mock('@/lib/sessionUtils', () => ({
  getAdminSession: mocks.session,
  requireAdminSession: () => ({ user: mocks.session() }),
  assertBusinessAccess: () => null,
}));
vi.mock('@/services/GoogleSheetsService', () => ({ GoogleSheetsService: mocks.sheets }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query, execute: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn().mockResolvedValue(null) }));

import { POST as autoReply } from '@/app/api/customer-service/auto-reply/route';
import { POST as answerQueries } from '@/app/api/customer-service/answer-queries/route';
import { POST as pushToCin7 } from '@/app/api/website/push-to-cin7/route';

function request(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('optional provider runtime boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.session.mockReturnValue({ businessId: 'business-1', userId: 1, tier: 'Admin' });
    mocks.enabled.mockResolvedValue(false);
    mocks.availability.mockResolvedValue({ gmail: { enabled: false } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('skips forced legacy automatic replies before Gmail or sheet work when off', async () => {
    const response = await autoReply(request('/api/customer-service/auto-reply', { force: true }));
    expect(await response.json()).toMatchObject({ success: true, skipped: 'Gmail integration disabled' });
    expect(mocks.sheets).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('blocks the direct Gmail answer workflow while off', async () => {
    const response = await answerQueries(request('/api/customer-service/answer-queries', { databaseId: 'business-1' }));
    expect(response.status).toBe(423);
    expect(mocks.sheets).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant Gmail answer requests before availability access', async () => {
    const response = await answerQueries(request('/api/customer-service/answer-queries', { databaseId: 'other' }));
    expect(response.status).toBe(403);
    expect(mocks.availability).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('blocks the legacy direct Cin7 publication route before sheet or provider work', async () => {
    const response = await pushToCin7(request('/api/website/push-to-cin7', { databaseId: 'business-1', productId: 1 }));
    expect(response.status).toBe(423);
    expect(mocks.sheets).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
