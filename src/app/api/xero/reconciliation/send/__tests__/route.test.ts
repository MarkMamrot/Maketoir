import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), recipients: vi.fn(), issues: vi.fn(), claim: vi.fn(),
  complete: vi.fn(), fail: vi.fn(), render: vi.fn(), send: vi.fn(), report: vi.fn(),
  events: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mocks.session, assertBusinessAccess: mocks.access }));
vi.mock('@/lib/xero/reconciliation/repository', () => ({
  getXeroReconciliationRecipients: mocks.recipients,
  getXeroReconciliationIssuesForEmail: mocks.issues,
  claimXeroReconciliationDelivery: mocks.claim,
  completeXeroReconciliationDelivery: mocks.complete,
  failXeroReconciliationDelivery: mocks.fail,
  recordXeroReconciliationEmailEvents: mocks.events,
}));
vi.mock('@/lib/xero/reconciliation/email', () => ({ renderReconciliationEmail: mocks.render, sendReconciliationEmail: mocks.send }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/xero/reconciliation/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/xero/reconciliation/send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Advisor', userId: 7, name: 'Alex', company: 'Shop' } });
    mocks.access.mockReturnValue(null);
    mocks.recipients.mockResolvedValue(['accounts@example.com']);
    mocks.issues.mockResolvedValue([{ id: 9, severity: 'error', targetType: 'sales_order', referenceId: '42', ruleKey: 'total', summary: 'Totals differ.', amount: 12, recommendedNextStep: 'Compare.' }]);
    mocks.claim.mockResolvedValue('claimed');
    mocks.render.mockReturnValue({ subject: 'Review', html: '<p>Review</p>' });
    mocks.send.mockResolvedValue('email-1');
    mocks.complete.mockResolvedValue(undefined);
    mocks.events.mockResolvedValue(undefined);
    mocks.fail.mockResolvedValue(undefined);
    mocks.report.mockResolvedValue(1);
  });

  it.each(['Admin', 'SuperAdmin', 'Advisor'])('allows %s to send open issues with an audited delivery', async tier => {
    mocks.session.mockReturnValue({ user: { businessId: 'biz-1', tier, userId: 7, name: 'Alex', company: 'Shop' } });
    const response = await POST(request({ databaseId: 'biz-1', issueIds: [9], deliveryKey: 'manual-request-123' }));
    expect(response.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ recipients: ['accounts@example.com'] }));
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', deliveryKey: 'manual-request-123', providerMessageId: 'email-1' }));
    expect(mocks.events).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', issueIds: [9] }));
  });

  it('requires configured recipients without reporting a validation failure', async () => {
    mocks.recipients.mockResolvedValue([]);
    const response = await POST(request({ databaseId: 'biz-1', issueIds: [9], deliveryKey: 'manual-request-123' }));
    expect(response.status).toBe(409);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('does not send issues that are absent or no longer open', async () => {
    mocks.issues.mockResolvedValue([]);
    const response = await POST(request({ databaseId: 'biz-1', issueIds: [9], deliveryKey: 'manual-request-123' }));
    expect(response.status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('marks a claimed delivery failed and reports provider errors', async () => {
    mocks.send.mockRejectedValue(new Error('Provider unavailable'));
    const response = await POST(request({ databaseId: 'biz-1', issueIds: [9], deliveryKey: 'manual-request-123' }));
    expect(response.status).toBe(500);
    expect(mocks.fail).toHaveBeenCalledWith(expect.objectContaining({ deliveryKey: 'manual-request-123' }));
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'send_to_accounts' }));
  });

  it('keeps an accepted delivery successful when issue-event fan-out fails', async () => {
    mocks.events.mockRejectedValue(new Error('Event insert failed'));
    const response = await POST(request({ databaseId: 'biz-1', issueIds: [9], deliveryKey: 'manual-request-123' }));
    expect(response.status).toBe(200);
    expect(mocks.fail).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'record_email_events' }));
  });

  it('blocks operational tiers before loading recipients', async () => {
    mocks.session.mockReturnValue({ user: { businessId: 'biz-1', tier: 'StandardUser', userId: 8, name: 'Sam' } });
    const response = await POST(request({ databaseId: 'biz-1', issueIds: [9], deliveryKey: 'manual-request-123' }));
    expect(response.status).toBe(403);
    expect(mocks.recipients).not.toHaveBeenCalled();
  });
});