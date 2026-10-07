import { beforeEach, describe, expect, it, vi } from 'vitest';
const { report, session } = vi.hoisted(() => ({ report: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: report }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: session }));
import { POST } from '../route';
beforeEach(() => { vi.clearAllMocks(); session.mockResolvedValue({ businessId: 'test-business' }); });
describe('terminal runtime issues', () => {
  it.each(['pos_terminal_refund', 'pos_terminal_purchase'])('persists %s with authenticated tenant context', async operation => {
    const response = await POST(new Request('http://localhost/api/runtime-issues/client', { method: 'POST', body: JSON.stringify({ operation, message: 'Terminal failed', pathname: '/pos' }) }));
    expect(response.status).toBe(200);
    expect(session).toHaveBeenCalledWith(['pos_session', 'marketoir_session']);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'test-business', source: 'pos_terminal', operation }));
  });
  it('rejects unauthenticated reports', async () => {
    session.mockResolvedValue(null);
    const response = await POST(new Request('http://localhost/api/runtime-issues/client', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(401);
    expect(report).not.toHaveBeenCalled();
  });
});