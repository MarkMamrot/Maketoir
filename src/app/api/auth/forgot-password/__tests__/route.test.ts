import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), send: vi.fn(), event: vi.fn(), report: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/auth/passwordSetupEmail', () => ({ sendPasswordSetupEmail: mocks.send }));
vi.mock('@/lib/auth/authActivity', () => ({ recordAuthEvent: mocks.event }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { POST } from '../route';

const request = (email: unknown = 'Person@example.com') => new Request('http://localhost/api/auth/forgot-password', {
  method: 'POST', body: JSON.stringify({ email }),
});
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('RESEND_API_KEY', 'test-only-provider-key');
  mocks.query.mockResolvedValue([{ id: 42, name: 'Morgan', business_id: 'business-a' }]);
  mocks.send.mockResolvedValue(undefined); mocks.event.mockResolvedValue(undefined); mocks.report.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe('password recovery visibility and enumeration protection', () => {
  it('records a request only after sending instructions', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ email: 'person@example.com', userId: 42 }));
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'password_reset_requested', userId: 42 }));
  });

  it('returns the same public success for an unknown account', async () => {
    const known = await POST(request());
    mocks.query.mockResolvedValueOnce([]);
    const unknown = await POST(request('unknown@example.com'));
    expect(await unknown.json()).toEqual(await known.json());
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('reports email failure without exposing whether the account exists', async () => {
    mocks.send.mockRejectedValueOnce(new Error('provider unavailable'));
    const response = await POST(request());
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'send_reset_instructions', businessId: 'business-a' }));
  });

  it('does not mislabel audit-storage failure as email delivery failure', async () => {
    mocks.event.mockRejectedValueOnce(new Error('audit unavailable'));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'request_reset' }));
    expect(mocks.report).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'send_reset_instructions' }));
  });

  it('reports unavailable recovery globally before looking up any account', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    expect((await POST(request())).status).toBe(503);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'email_service_unconfigured' }));
  });

  it.each([null, 123, '', 'not-an-email'])('rejects invalid email without operational reports', async email => {
    expect((await POST(request(email))).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalled();
  });
});
