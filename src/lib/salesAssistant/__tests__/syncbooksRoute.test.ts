import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), rate: vi.fn(), alert: vi.fn(), report: vi.fn() }));
vi.mock('../repository', () => ({ salesAssistantRepository: { createConsentedLead: mocks.create, consumeRateLimit: mocks.rate } }));
vi.mock('../leadAlerts', () => ({ deliverProspectLeadAlert: mocks.alert }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { POST } from '@/app/api/public/syncbooks/enquiry/route';

const body = { name: 'Controlled test', business: 'Test business', email: 'test@example.com', consentEmail: true, employees: '6-15 employees', delivery: 'Blended', needs: 'Payroll', software: 'Xero' };
function request(overrides = {}, headers = {}) {
  return new Request('http://localhost:3039/api/public/syncbooks/enquiry', { method: 'POST', headers: { origin: 'http://localhost:3039', 'content-type': 'application/json', 'idempotency-key': '12345678-1234-1234-1234-123456789012', ...headers }, body: JSON.stringify({ ...body, ...overrides }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SALES_ASSISTANT_HMAC_SECRET', 'test-only-secret-at-least-thirty-two-characters');
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.create.mockResolvedValue({ leadId: 42 });
  mocks.alert.mockResolvedValue(false);
  mocks.report.mockResolvedValue(null);
});
describe('SyncBooks enquiry route', () => {
  it('owns source and service, saves before notification, accepts queued delivery', async () => {
    const response = await POST(request({ sourcePath: '/spoof', service: 'other', conversationId: 'spoof' }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ reference: 'SL-42', alertSent: false, alertQueued: true });
    expect(mocks.create.mock.calls[0][0].lead).toMatchObject({ sourcePath: '/syncbooks', enquiryDetails: { service: 'syncbooks', teamSize: '6-15 employees', deliveryModel: 'Blended', needs: 'Payroll' } });
    expect(mocks.create.mock.calls[0][0].lead.conversationId).toBeUndefined();
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.alert.mock.invocationCallOrder[0]);
  });
  it('rejects absent consent, honeypot, oversized fields and invalid choices', async () => {
    for (const values of [{ consentEmail: false }, { website: 'bot' }, { needs: 'x'.repeat(3001) }, { delivery: 'Unknown' }, { business: '' }]) {
      expect((await POST(request(values))).status).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects cross-origin and oversized bodies without saving', async () => {
    expect((await POST(request({}, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await POST(request({}, { 'content-length': '25000' }))).status).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('enforces shared rate limits', async () => {
    mocks.rate.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('does not notify when persistence fails and reports no submitted fields', async () => {
    mocks.create.mockRejectedValue(new Error('storage unavailable'));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.report.mock.calls)).not.toContain(body.email);
  });
  it('confirms a saved enquiry even if notification connection acquisition throws', async () => {
    mocks.alert.mockRejectedValue(new Error('connection unavailable'));
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ reference: 'SL-42', alertQueued: true });
    expect(mocks.report).toHaveBeenCalled();
  });
});