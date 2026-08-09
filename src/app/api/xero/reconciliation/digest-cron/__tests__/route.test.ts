import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), issues: vi.fn(), claim: vi.fn(), complete: vi.fn(), fail: vi.fn(),
  mark: vi.fn(), events: vi.fn(), render: vi.fn(), send: vi.fn(), report: vi.fn(), schedule: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({
  listOpenXeroReconciliationIssuesForDigest: mocks.issues,
  claimXeroReconciliationDelivery: mocks.claim,
  completeXeroReconciliationDelivery: mocks.complete,
  failXeroReconciliationDelivery: mocks.fail,
  markXeroReconciliationDigestCompleted: mocks.mark,
  recordXeroReconciliationEmailEvents: mocks.events,
}));
vi.mock('@/lib/xero/reconciliation/email', () => ({ renderReconciliationEmail: mocks.render, sendReconciliationEmail: mocks.send }));
vi.mock('@/lib/xero/reconciliation/digestSchedule', () => ({ getReconciliationDigestSchedule: mocks.schedule }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

function request(secret = 'secret') {
  return new Request('http://localhost/api/xero/reconciliation/digest-cron', { method: 'POST', headers: { 'x-cron-secret': secret } });
}

describe('POST /api/xero/reconciliation/digest-cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'secret';
    mocks.query.mockResolvedValue([{
      business_id: 'biz-1', business_name: 'Shop', recipients_json: '["accounts@example.com"]',
      digest_frequency: 'daily', digest_timezone: 'Australia/Sydney', digest_hour: 8,
      digest_weekly_day: 1, last_digest_completed_at: null,
    }]);
    mocks.schedule.mockReturnValue({ due: true, periodKey: 'daily-2026-08-09', scheduledLocalDate: '2026-08-09' });
    mocks.issues.mockResolvedValue([{ id: 9, severity: 'error', targetType: 'sales_order', referenceId: '42', ruleKey: 'total', summary: 'Totals differ.', amount: 12, recommendedNextStep: 'Compare.', mismatchFingerprint: 'mismatch-9' }]);
    mocks.claim.mockResolvedValue('claimed');
    mocks.render.mockReturnValue({ subject: 'Digest', html: '<p>Digest</p>' });
    mocks.send.mockResolvedValue('email-1');
    mocks.complete.mockResolvedValue(undefined);
    mocks.mark.mockResolvedValue(undefined);
    mocks.events.mockResolvedValue(undefined);
    mocks.fail.mockResolvedValue(undefined);
    mocks.report.mockResolvedValue(1);
  });

  it('requires the cron secret', async () => {
    expect((await POST(request('wrong'))).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('sends the current open issue digest with a cadence-stable delivery key', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ deliveryKey: 'digest-daily-2026-08-09', deliveryType: 'digest', issueIds: [9] }));
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ recipients: ['accounts@example.com'] }));
    expect(mocks.mark).toHaveBeenCalledWith('biz-1');
    expect(mocks.events).toHaveBeenCalledWith(expect.objectContaining({ actorName: 'Scheduled digest' }));
  });

  it('marks an empty due period complete without sending', async () => {
    mocks.issues.mockResolvedValue([]);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.mark).toHaveBeenCalledWith('biz-1');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('skips businesses that are not due', async () => {
    mocks.schedule.mockReturnValue({ due: false, periodKey: 'daily-2026-08-09', scheduledLocalDate: '2026-08-09' });
    await POST(request());
    expect(mocks.issues).not.toHaveBeenCalled();
  });

  it('records and reports a failed claimed delivery without completing the period', async () => {
    mocks.send.mockRejectedValue(new Error('Provider unavailable'));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.fail).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', deliveryKey: 'digest-daily-2026-08-09' }));
    expect(mocks.mark).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'send_digest' }));
  });

  it('completes the period when the same provider-idempotent delivery already succeeded', async () => {
    mocks.claim.mockResolvedValue('already_sent');
    await POST(request());
    expect(mocks.mark).toHaveBeenCalledWith('biz-1');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});