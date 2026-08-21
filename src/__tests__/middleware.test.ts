import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const verifySession = vi.fn();

vi.mock('@/lib/auth/adminSessionTokenEdge', () => ({
  verifyAdminSessionEdge: (...args: unknown[]) => verifySession(...args),
}));

import { middleware } from '@/middleware';

function request(method: string, includePreview = true) {
  const cookies = ['marketoir_session=admin'];
  if (includePreview) cookies.push('wholesale_preview_session=preview');
  return new NextRequest('http://localhost/api/wholesale/orders', {
    method,
    headers: { cookie: cookies.join('; ') },
  });
}

function previewRequestWithoutAdmin(method: string) {
  return new NextRequest('http://localhost/api/wholesale/orders', {
    method,
    headers: { cookie: 'wholesale_preview_session=preview' },
  });
}

describe('wholesale staff preview middleware', () => {
  beforeEach(() => {
    verifySession.mockImplementation(async (token: string) => token === 'preview'
      ? { businessId: 'tenant-1', preview: { actorUserId: 42 } }
      : { businessId: 'tenant-1', tier: 'Admin', userId: 42 });
  });

  it('allows preview GET requests', async () => {
    const response = await middleware(request('GET'));
    expect(response.status).toBe(200);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects preview %s requests', async method => {
    const response = await middleware(request(method));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'wholesale_preview_read_only' });
  });

  it('does not block ordinary wholesale mutations', async () => {
    const response = await middleware(request('POST', false));
    expect(response.status).toBe(200);
  });

  it('still blocks writes after the IMS admin cookie disappears', async () => {
    const response = await middleware(previewRequestWithoutAdmin('POST'));
    expect(response.status).toBe(403);
  });
});