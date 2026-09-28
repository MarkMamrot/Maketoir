import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  query: vi.fn(),
  sendPasswordSetupEmail: vi.fn(),
  recordAuthEvent: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ getAdminSession: mocks.session }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/auth/passwordSetupEmail', () => ({ sendPasswordSetupEmail: mocks.sendPasswordSetupEmail }));
vi.mock('@/lib/auth/authActivity', () => ({ recordAuthEvent: mocks.recordAuthEvent }));

import { GET, POST } from '../route';

const context = { params: { userId: '42' } };

describe('/api/admin/users/[userId]/auth-activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockReturnValue({ userId: 7, tier: 'Admin', businessId: 'biz-1' });
    mocks.sendPasswordSetupEmail.mockResolvedValue(undefined);
    mocks.recordAuthEvent.mockResolvedValue(undefined);
  });

  it('denies non-admin users', async () => {
    mocks.session.mockReturnValue({ userId: 9, tier: 'StandardUser', businessId: 'biz-1' });

    const response = await GET(new Request('http://localhost'), context);

    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('does not expose a user outside the active business', async () => {
    mocks.query.mockResolvedValueOnce([]);

    const response = await POST(new Request('http://localhost', { method: 'POST' }), context);

    expect(response.status).toBe(404);
    expect(mocks.query.mock.calls[0][1]).toEqual([42, 'biz-1']);
    expect(mocks.sendPasswordSetupEmail).not.toHaveBeenCalled();
  });

  it('sends and records an Admin-triggered reset after membership validation', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 42, email: 'user@example.com', name: 'User' }]);
    const request = new Request('http://localhost', { method: 'POST' });

    const response = await POST(request, context);

    expect(response.status).toBe(200);
    expect(mocks.sendPasswordSetupEmail).toHaveBeenCalledWith({
      userId: 42,
      email: 'user@example.com',
      name: 'User',
      businessId: 'biz-1',
      purpose: 'reset',
    });
    expect(mocks.recordAuthEvent).toHaveBeenCalledWith({
      userId: 42,
      businessId: 'biz-1',
      eventType: 'password_reset_requested',
      actorUserId: 7,
      request,
    });
  });

  it('returns only recent activity associated with the active business', async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: 42, email: 'user@example.com', name: 'User' }])
      .mockResolvedValueOnce([{ id: 1, event_type: 'login_success' }]);

    const response = await GET(new Request('http://localhost'), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(mocks.query.mock.calls[1][0]).toContain('INTERVAL 90 DAY');
    expect(mocks.query.mock.calls[1][1]).toEqual([42, 'biz-1']);
  });
});