import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), getConfig: vi.fn(), setConfig: vi.fn(), getData: vi.fn(), updateData: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ getAdminSession: mocks.session }));
vi.mock('@/lib/db/ConfigRepository', () => ({ ConfigRepository: { get: mocks.getConfig, set: mocks.setConfig } }));
vi.mock('@/services/GoogleSheetsService', () => ({ GoogleSheetsService: class {
  getData = mocks.getData;
  updateData = mocks.updateData;
  addSheetIfNotExists = vi.fn();
  appendData = vi.fn();
} }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET, POST } from '../route';
import { MARKETING_SCHEDULED_AUTOMATION_KEY } from '@/lib/foresight/marketingAutomationSettings';

function request(changes: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/user/marketing-settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ databaseId: 'business-1', highMin: 65, midMin: 40, budgetChangeNotificationEmail: '', ...changes }),
  });
}

describe('marketing settings scheduled automation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockReturnValue({ businessId: 'business-1', tier: 'SuperAdmin' });
    mocks.getConfig.mockResolvedValue(null);
    mocks.setConfig.mockResolvedValue(undefined);
    mocks.getData.mockResolvedValue([['Key', 'Value'], ['MarginTier_High', '65'], ['MarginTier_Mid', '40']]);
    mocks.updateData.mockResolvedValue(undefined);
    mocks.report.mockResolvedValue(null);
  });

  it.each([null, 'true', 'false'])('loads the saved preference with backwards-compatible defaults (%s)', async value => {
    mocks.getConfig.mockImplementation(async (_businessId: string, key: string) => key === MARKETING_SCHEDULED_AUTOMATION_KEY ? value : '');
    const response = await GET(new Request('http://localhost/api/user/marketing-settings?databaseId=business-1'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scheduledMarketingEnabled: value !== 'false' });
  });

  it.each([true, false])('saves the boolean only for the verified session business (%s)', async enabled => {
    const response = await POST(request({ scheduledMarketingEnabled: enabled }));
    expect(response.status).toBe(200);
    expect(mocks.setConfig).toHaveBeenCalledWith('business-1', MARKETING_SCHEDULED_AUTOMATION_KEY, String(enabled));
    expect(await response.json()).toMatchObject({ scheduledMarketingEnabled: enabled });
  });

  it('preserves a saved preference when an older client omits it', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.setConfig.mock.calls.some(call => call[1] === MARKETING_SCHEDULED_AUTOMATION_KEY)).toBe(false);
  });

  it('rejects cross-business saves before any writes', async () => {
    expect((await POST(request({ databaseId: 'business-2', scheduledMarketingEnabled: false }))).status).toBe(403);
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.updateData).not.toHaveBeenCalled();
  });

  it.each(['false', 0, null])('rejects non-boolean switch values (%s)', async value => {
    expect((await POST(request({ scheduledMarketingEnabled: value }))).status).toBe(400);
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without reporting a validation failure as a runtime issue', async () => {
    const response = await POST(new Request('http://localhost/api/user/marketing-settings', { method: 'POST', body: '{' }));
    expect(response.status).toBe(400);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.setConfig).not.toHaveBeenCalled();
  });

  it('requires an authenticated session', async () => {
    mocks.session.mockReturnValue(null);
    expect((await POST(request({ scheduledMarketingEnabled: false }))).status).toBe(401);
    expect(mocks.setConfig).not.toHaveBeenCalled();
  });
});