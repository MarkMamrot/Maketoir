import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connection: {
    beginTransaction: vi.fn(),
    execute: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  },
  hash: vi.fn(),
  recordAuthEvent: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({
  getPool: () => ({ getConnection: vi.fn().mockResolvedValue(mocks.connection) }),
}));
vi.mock('bcryptjs', () => ({ default: { hash: mocks.hash } }));
vi.mock('@/lib/auth/authActivity', () => ({ recordAuthEvent: mocks.recordAuthEvent }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { POST } from '../route';

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hash.mockResolvedValue('password-hash');
    mocks.recordAuthEvent.mockResolvedValue(undefined);
    mocks.connection.beginTransaction.mockResolvedValue(undefined);
    mocks.connection.commit.mockResolvedValue(undefined);
    mocks.connection.rollback.mockResolvedValue(undefined);
    mocks.connection.execute
      .mockResolvedValueOnce([[{
        id: 3,
        user_id: 42,
        business_id: 'biz-1',
        expires_at: new Date(Date.now() + 60_000),
        used_at: null,
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValue([{ affectedRows: 1 }]);
  });

  it('uses a token digest, preserves MFA enrollment, revokes trust, and records completion', async () => {
    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.8' },
      body: JSON.stringify({ token: 'raw-reset-token', password: 'new-password' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const tokenLookup = mocks.connection.execute.mock.calls[0];
    expect(tokenLookup[0]).toContain('token IN (?, ?)');
    expect(tokenLookup[1][0]).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenLookup[1][0]).not.toBe('raw-reset-token');
    expect(tokenLookup[1][1]).toBe('raw-reset-token');

    const statements = mocks.connection.execute.mock.calls.map(call => String(call[0])).join('\n');
    expect(statements).not.toContain('mfa_totp_secret = NULL');
    expect(statements).not.toContain('DELETE FROM mfa_recovery_codes');
    expect(statements).toContain('UPDATE mfa_trusted_browsers');
    expect(statements).toContain('UPDATE mfa_preauth_sessions');
    expect(mocks.recordAuthEvent).toHaveBeenCalledWith({
      userId: 42,
      businessId: 'biz-1',
      eventType: 'password_reset_completed',
      request,
    });
  });
});