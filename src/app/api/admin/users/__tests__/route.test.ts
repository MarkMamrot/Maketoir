import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findByEmail: vi.fn(),
  create: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  enroll: vi.fn(),
  sendPasswordSetupEmail: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ getAdminSession: mocks.session }));
vi.mock('@/lib/db/UsersRepository', () => ({
  UsersRepository: { findByEmail: mocks.findByEmail, create: mocks.create },
}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query, execute: mocks.execute }));
vi.mock('@/lib/auth/businessMemberships', () => ({ enrollUserInBusiness: mocks.enroll }));
vi.mock('@/lib/auth/passwordSetupEmail', () => ({ sendPasswordSetupEmail: mocks.sendPasswordSetupEmail }));

import { POST } from '../route';

describe('POST /api/admin/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockReturnValue({ userId: 7, tier: 'Admin', businessId: 'biz-1' });
    mocks.findByEmail.mockResolvedValue(null);
    mocks.query.mockResolvedValue([]);
    mocks.create.mockResolvedValue(42);
    mocks.enroll.mockResolvedValue(undefined);
    mocks.sendPasswordSetupEmail.mockResolvedValue(undefined);
  });

  it('creates a new user and sends a first-time password email', async () => {
    const response = await POST(new Request('http://localhost/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'new.user@example.com',
        name: 'New User',
        tier: 'StandardUser',
        passwordMode: 'email',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new.user@example.com',
      password: expect.any(String),
      businessId: 'biz-1',
    }));
    expect(mocks.create.mock.calls[0][0].password.length).toBeGreaterThan(40);
    expect(mocks.enroll).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, businessId: 'biz-1' }));
    expect(mocks.sendPasswordSetupEmail).toHaveBeenCalledWith({
      userId: 42,
      email: 'new.user@example.com',
      name: 'New User',
      businessId: 'biz-1',
      purpose: 'set',
    });
    await expect(response.json()).resolves.toMatchObject({ success: true, userId: 42 });
  });

  it('still requires a password in manual mode', async () => {
    const response = await POST(new Request('http://localhost/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new.user@example.com', passwordMode: 'manual' }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.sendPasswordSetupEmail).not.toHaveBeenCalled();
  });
});