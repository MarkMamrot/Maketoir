import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), release: vi.fn(), query: vi.fn(), send: vi.fn(), report: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ getPool: () => ({ getConnection: async () => ({ execute: mocks.execute, release: mocks.release }) }), query: mocks.query }));
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.send }; } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { deliverProspectLeadAlert, retryPendingProspectLeadAlerts } from '../leadAlerts';
let details: unknown;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RESEND_API_KEY', 'test'); vi.stubEnv('SALES_LEAD_RECIPIENTS', 'team@example.com');
  details = { service: 'syncbooks', teamSize: '1-5 employees', deliveryModel: 'Local', needs: '<script>unsafe</script>' };
  mocks.execute.mockImplementation(async (sql: string) => {
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.includes('SELECT l.id')) return [[{ id: 42, name: 'Test', company: '<Company>', preferred_contact: 'email', source_path: '/syncbooks', enquiry_details_json: details, current_systems: '<Xero>', alert_sent: 0 }]];
    return [{ affectedRows: 1 }];
  });
  mocks.send.mockResolvedValue({ error: null }); mocks.report.mockResolvedValue(null);
});
describe('prospect alert delivery', () => {
  it('selects SyncBooks, escapes every brief field and uses provider idempotency', async () => {
    expect(await deliverProspectLeadAlert(42)).toBe(true);
    const [message, options] = mocks.send.mock.calls[0];
    expect(message.subject).toContain('SyncBooks enquiry');
    expect(message.html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(message.html).toContain('&lt;Xero&gt;');
    expect(message.html).not.toContain('<script>');
    expect(options).toEqual({ idempotencyKey: 'prospect-lead-alert-42' });
  });
  it('retains the assistant lead template when metadata is absent', async () => {
    details = null;
    await deliverProspectLeadAlert(42);
    expect(mocks.send.mock.calls[0][0].subject).toContain('Solvantis sales lead');
  });
  it('leaves failures retryable and retries pending leads', async () => {
    mocks.send.mockResolvedValueOnce({ error: { message: 'unavailable' } });
    expect(await deliverProspectLeadAlert(42)).toBe(false);
    expect(mocks.execute.mock.calls.some(([sql]) => sql.includes("'alert_failed'"))).toBe(true);
    mocks.query.mockResolvedValue([{ id: 42 }]);
    expect(await retryPendingProspectLeadAlerts()).toEqual({ attempted: 1, sent: 1 });
    expect(mocks.query.mock.calls[0][0]).toContain("event_type = 'alert_pending'");
  });
});