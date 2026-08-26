import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const verifySession = vi.fn();

vi.mock('@/lib/auth/adminSessionTokenEdge', () => ({
  verifyAdminSessionEdge: (...args: unknown[]) => verifySession(...args),
}));

import { middleware } from '@/middleware';

function request(method: string, includePreview = true, pathname = '/api/wholesale/orders') {
  const cookies = ['marketoir_session=admin'];
  if (includePreview) cookies.push('wholesale_preview_session=preview');
  return new NextRequest(`http://localhost${pathname}`, {
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

  function enableTestMode() {
    verifySession.mockImplementation(async (token: string) => token === 'preview'
      ? { businessId: 'tenant-1', preview: { actorUserId: 42, mode: 'ims_draft_test' } }
      : { businessId: 'tenant-1', tier: 'Admin', userId: 42 });
  }

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

  it.each([
    ['POST', '/api/wholesale/orders'],
    ['PUT', '/api/wholesale/orders/12'],
    ['DELETE', '/api/wholesale/orders/12'],
    ['POST', '/api/wholesale/orders/12/submit'],
    ['POST', '/api/wholesale/account/location'],
  ])('allows test-mode commerce write %s %s', async (method, pathname) => {
    enableTestMode();
    expect((await middleware(request(method, true, pathname))).status).toBe(200);
  });

  it.each([
    ['PUT', '/api/wholesale/account'],
    ['POST', '/api/wholesale/account/team'],
    ['POST', '/api/wholesale/saved-lists'],
    ['PUT', '/api/wholesale/saved-lists/favourites'],
  ])('blocks non-commerce test-mode write %s %s', async (method, pathname) => {
    enableTestMode();
    expect((await middleware(request(method, true, pathname))).status).toBe(403);
  });
});

describe('online shop custom-domain middleware', () => {
  beforeEach(() => {
    vi.stubEnv('APP_URL', 'https://solvantis.com.au');
  });

  it('treats the www host as the main Solvantis platform', async () => {
    const resolveDomain = vi.fn();
    vi.stubGlobal('fetch', resolveDomain);
    const response = await middleware(new NextRequest('https://www.solvantis.com.au/', {
      headers: { host: 'www.solvantis.com.au' },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(resolveDomain).not.toHaveBeenCalled();
  });

  it('rewrites a verified custom host into the existing storefront route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ slug: 'shop-one' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    const response = await middleware(new NextRequest('https://store-one.example/products/widget', {
      headers: { host: 'store-one.example' },
    }));
    expect(response.headers.get('x-middleware-rewrite')).toContain('/shop/shop-one/products/widget');
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ hostname: 'solvantis.com.au' }), expect.anything());
  });

  it('redirects hosted storefront links back to a clean custom-domain path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ slug: 'shop-two' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    const response = await middleware(new NextRequest('https://store-two.example/shop/shop-two/checkout', {
      headers: { host: 'store-two.example' },
    }));
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://store-two.example/checkout');
  });

  it('isolates an unresolved custom host from the main application', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    const response = await middleware(new NextRequest('https://unknown-store.example/', {
      headers: { host: 'unknown-store.example' },
    }));
    expect(response.headers.get('x-middleware-rewrite')).toContain('/404');
  });
});