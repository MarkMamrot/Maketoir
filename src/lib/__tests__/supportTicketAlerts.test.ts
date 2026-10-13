import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn(), report: vi.fn(), setStatus: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.send }; } }));
vi.mock('@/lib/supportTickets', () => ({ getSupportTicketNotificationEmail: vi.fn(), setSupportTicketUpdateEmailStatus: mocks.setStatus }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { sendSupportTicketStaffEmail } from '../supportTicketAlerts';

const ticket = { id: 8, business_id: 'test', submitted_by_email: 'staff@example.com', subject: '<Issue>', resolution_notes: '<Fixed>' };

describe('support ticket staff emails', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('RESEND_API_KEY', 'test');
    vi.stubEnv('RESEND_FROM_EMAIL', 'Solvantis <support@example.com>');
    mocks.send.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each(['', 'Solvantis <onboarding@resend.dev>'])('does not attempt customer delivery with an unconfigured or testing sender (%s)', async sender => {
    vi.stubEnv('RESEND_FROM_EMAIL', sender);
    await expect(sendSupportTicketStaffEmail(ticket, 'updated', { id: 12, message: 'Investigating' })).resolves.toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'test', operation: 'send_staff_updated_email',
      error: expect.objectContaining({ message: expect.stringContaining('verified sending domain') }),
    }));
  });
  it('sends a separate escaped receipt to the submitter', async () => {
    await sendSupportTicketStaffEmail(ticket, 'created');
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: ['staff@example.com'], html: expect.stringContaining('&lt;Issue&gt;') }), { idempotencyKey: 'support-ticket-staff-created-8' });
  });
  it('includes escaped resolution notes', async () => {
    await sendSupportTicketStaffEmail(ticket, 'resolved');
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining('&lt;Fixed&gt;') }), { idempotencyKey: 'support-ticket-staff-resolved-8' });
  });
  it('reports delivery failures without rejecting', async () => {
    mocks.send.mockResolvedValue({ error: { message: 'Delivery failed' } });
    await expect(sendSupportTicketStaffEmail(ticket, 'created')).resolves.toBe(false);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'test', operation: 'send_staff_created_email' }));
  });
  it('skips tickets with no email', async () => {
    await sendSupportTicketStaffEmail({ ...ticket, submitted_by_email: null }, 'created');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('emails each new update using its unique delivery key and ticket number', async () => {
    expect(await sendSupportTicketStaffEmail(ticket, 'updated', { id: 12, message: '<Investigating>' })).toBe(true);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringContaining('#8'), html: expect.stringContaining('&lt;Investigating&gt;') }), { idempotencyKey: 'support-ticket-update-12' });
  });
});