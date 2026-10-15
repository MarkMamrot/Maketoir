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
  compare: vi.fn(),
  clearSession: vi.fn(),
  clearTrust: vi.fn(),
  recordAuthEvent: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({
  getPool: () => ({ getConnection: vi.fn().mockResolvedValue(mocks.connection) }),
}));
vi.mock('bcryptjs', () => ({ default: { hash: mocks.hash, compare: mocks.compare } }));
vi.mock('@/lib/auth/adminAuthCookies', () => ({
  clearAdminSessionCookie: mocks.clearSession, clearMfaTrustCookie: mocks.clearTrust,
}));
vi.mock('@/lib/auth/authActivity', () => ({ recordAuthEvent: mocks.recordAuthEvent }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { POST } from '../route';

const owner = () => ({
  password_hash: 'current-hash', username: 'operator', email: 'operator@example.com', name: 'Morgan Person',
  password_changed_at: new Date(Date.now() - 2 * 86400000) as Date | string | null,
});
function database(user = owner(), history: Array<{ password_hash: string }> = []) {
  mocks.connection.execute.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM password_reset_tokens')) return [[{
      id: 3, user_id: 42, business_id: 'biz-1', expires_at: new Date(Date.now() + 60000), used_at: null,
    }]];
    if (sql.includes('FROM users')) return [[user]];
    if (sql.includes('SELECT password_hash FROM user_password_history')) return [history];
    return [{ affectedRows: 1 }];
  });
}
const request = (password: unknown = 'FreshReset9!') => new Request('http://localhost/api/auth/reset-password', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: 'raw-reset-token', password }),
});

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.hash.mockResolvedValue('password-hash');
    mocks.compare.mockResolvedValue(false);
    mocks.recordAuthEvent.mockResolvedValue(undefined);
    mocks.connection.beginTransaction.mockResolvedValue(undefined);
    mocks.connection.commit.mockResolvedValue(undefined);
    mocks.connection.rollback.mockResolvedValue(undefined);
    database();
  });

  it('uses a token digest, preserves MFA enrollment, revokes trust, and records completion', async () => {
    const request = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.8' },
      body: JSON.stringify({ token: 'raw-reset-token', password: 'FreshReset9!' }),
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
    expect(statements).toContain('password_changed_at = NOW(3)');
    expect(statements).toContain('LIMIT 9');
    expect(mocks.clearSession).toHaveBeenCalledOnce();
    expect(mocks.clearTrust).toHaveBeenCalledOnce();
    expect(mocks.recordAuthEvent).toHaveBeenCalledWith({
      userId: 42,
      businessId: 'biz-1',
      eventType: 'password_reset_completed',
      request,
    });
  });

  it.each([null, {}, 123, 'short', 'NoSpecialHere9'])('rejects invalid passwords without a transaction', async password => {
    expect((await POST(request(password))).status).toBe(400);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.connection.beginTransaction).not.toHaveBeenCalled();
    expect(mocks.reportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('treats malformed JSON as validation', async () => {
    expect((await POST(new Request('http://localhost/api/auth/reset-password', { method: 'POST', body: '{' }))).status).toBe(400);
    expect(mocks.reportRuntimeIssue).not.toHaveBeenCalled();
  });

  it.each([0, 9])('rejects reuse of the current password or ninth prior password (position %s)', async position => {
    database(owner(), Array.from({ length: 9 }, (_, index) => ({ password_hash: `previous-${index}` })));
    mocks.compare.mockImplementation(async (_password: string, hash: string) => hash === (position === 0 ? 'current-hash' : 'previous-8'));
    expect((await POST(request())).status).toBe(400);
    expect(mocks.connection.commit).not.toHaveBeenCalled();
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
    expect(mocks.connection.release).toHaveBeenCalledOnce();
    expect(mocks.connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO user_password_history'))).toBe(false);
    expect(mocks.reportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('rejects a change inside one day without consuming the link or modifying MFA', async () => {
    database({ ...owner(), password_changed_at: new Date(Date.now() - 23 * 3600000) });
    expect((await POST(request())).status).toBe(400);
    expect(mocks.connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
  });

  it.each([null, 'one-day-boundary'])('allows initial renewal and the exact one-day boundary: %s', async age => {
    database({ ...owner(), password_changed_at: age === null ? null : new Date(Date.now() - 86400000) });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
  });

  it('validates the account name after locking the user', async () => {
    expect((await POST(request('FreshMORGAN9!'))).status).toBe(400);
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
    expect(mocks.connection.commit).not.toHaveBeenCalled();
  });

  it('rolls back and reports corrupted password-age metadata', async () => {
    database({ ...owner(), password_changed_at: 'invalid' });
    expect((await POST(request())).status).toBe(500);
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
    expect(mocks.connection.release).toHaveBeenCalledOnce();
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledOnce();
    expect(mocks.clearSession).not.toHaveBeenCalled();
  });
});