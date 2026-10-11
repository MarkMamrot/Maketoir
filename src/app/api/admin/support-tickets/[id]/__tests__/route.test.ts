import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), list: vi.fn(), save: vi.fn(), send: vi.fn(), images: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/supportTickets', () => ({ getSupportTicket: mocks.get, listSupportTicketUpdates: mocks.list, saveSupportTicketUpdate: mocks.save, isSupportTicketStatus: (value: string) => ['open', 'in_progress', 'resolved', 'closed'].includes(value) }));
vi.mock('@/lib/supportTicketAlerts', () => ({ sendSupportTicketUpdateEmail: mocks.send }));
vi.mock('@/lib/supportTicketImages', () => ({ listSupportImages: mocks.images }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { GET, PATCH } from '../route';

const context = { params: { id: '8' } };
const update = { id: 12, ticket_id: 8, message: 'Investigating', email_status: 'pending' };
const body = { status: 'in_progress', assignedTo: null, message: 'Investigating', requestId: '12345678-1234-1234-1234-123456789abc' };
const request = (payload: object) => new Request('http://localhost/ticket', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

describe('support ticket updates API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockReturnValue({ user: { name: 'Admin' } });
    mocks.get.mockResolvedValue({ id: 8, business_id: 'test', status: 'open', submitted_by_email: 'staff@example.com' });
    mocks.save.mockResolvedValue(update); mocks.send.mockResolvedValue('sent');
    mocks.list.mockResolvedValue([update]); mocks.images.mockResolvedValue([]);
  });
  it('returns the update timeline with ticket details', async () => {
    expect((await (await GET(new Request('http://localhost/ticket'), context)).json()).ticket.updates).toEqual([update]);
  });
  it('posts a numbered update and emails the original submitter', async () => {
    const response = await PATCH(request(body), context);
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(8, expect.objectContaining({ authorName: 'Admin', message: 'Investigating' }));
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ submitted_by_email: 'staff@example.com' }), update);
  });
  it('retries an existing update without appending another message', async () => {
    expect((await PATCH(request({ ...body, retryUpdateId: 12 }), context)).status).toBe(200);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('cannot retry an update from another ticket', async () => {
    expect((await PATCH(request({ ...body, retryUpdateId: 99 }), context)).status).toBe(404);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('rejects oversized messages before saving or emailing', async () => {
    expect((await PATCH(request({ ...body, message: 'x'.repeat(10_001) }), context)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});