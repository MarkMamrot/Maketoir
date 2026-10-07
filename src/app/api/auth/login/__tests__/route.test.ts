import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ report: vi.fn(), findByEmail: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/db/UsersRepository', () => ({ UsersRepository: { findByEmail: mocks.findByEmail } }));

import { POST } from '../route';

describe('login request validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['{', '', 'null', '[]', 'true', '{"email":123,"password":true,"destination":"ims"}', '{}'])('rejects invalid body %s without reporting a runtime failure', async body => {
    const response = await POST(new Request('http://localhost/api/auth/login', { method: 'POST', body }));
    expect(response.status).toBe(400);
    expect(mocks.findByEmail).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });
});