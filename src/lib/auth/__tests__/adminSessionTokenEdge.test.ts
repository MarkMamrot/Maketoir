import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAdminSession } from '../adminSessionToken';
import { verifyAdminSessionEdge } from '../adminSessionTokenEdge';

const NOW_MS = Date.UTC(2026, 7, 16, 10, 0, 0);
const SESSION = { userId: 7, businessId: 'biz-7', tier: 'Advisor' };

describe('adminSessionTokenEdge', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-only-session-secret-with-at-least-32-bytes');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('verifies tokens created by the Node session signer', async () => {
    const token = signAdminSession(SESSION, { maxAgeSeconds: 600, nowMs: NOW_MS });

    await expect(verifyAdminSessionEdge(token, NOW_MS)).resolves.toEqual(SESSION);
  });

  it('rejects legacy, tampered, and expired tokens', async () => {
    const token = signAdminSession(SESSION, { maxAgeSeconds: 60, nowMs: NOW_MS });
    const tampered = JSON.parse(token);
    tampered.tier = 'SuperAdmin';

    await expect(verifyAdminSessionEdge(JSON.stringify(SESSION), NOW_MS)).resolves.toBeNull();
    await expect(verifyAdminSessionEdge(JSON.stringify(tampered), NOW_MS)).resolves.toBeNull();
    await expect(verifyAdminSessionEdge(token, NOW_MS + 60_000)).resolves.toBeNull();
  });
});