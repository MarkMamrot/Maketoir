import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyAdminSessionEdge } from '@/lib/auth/adminSessionTokenEdge';
import { isWholesalePreviewMutationAllowed, type WholesaleStaffPreviewMode } from '@/lib/wholesale/wholesalePortalSettings';

/**
 * Global write-access guard.
 *
 * Advisor-tier accounts are strictly READ-ONLY across the IMS. This middleware
 * blocks every mutating request (POST/PUT/PATCH/DELETE) to the IMS/inventory
 * APIs for Advisor users, regardless of what the UI allows. Read requests (GET/
 * HEAD/OPTIONS) always pass through.
 *
 * This is the authoritative enforcement point — individual routes may add their
 * own checks, but this guarantees no Advisor write can reach a handler.
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PUBLIC_AUTH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/accept-invite',
  '/api/auth/mfa/enroll',
  '/api/auth/mfa/enroll/verify',
  '/api/auth/mfa/challenge',
]);

const domainCache = new Map<string, { slug: string | null; expiresAt: number }>();

function requestHostname(req: NextRequest): string {
  const raw = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host')?.trim() || req.nextUrl.hostname;
  try { return new URL(`https://${raw}`).hostname.toLowerCase(); } catch { return ''; }
}

function isPlatformHostname(hostname: string): boolean {
  return !hostname || hostname === 'localhost' || hostname === '127.0.0.1'
    || hostname === 'solvantis.com.au' || hostname === 'www.solvantis.com.au'
    || hostname.endsWith('.solvantis.com.au') || hostname.endsWith('.railway.app') || hostname.endsWith('.vercel.app');
}

async function resolveCustomDomain(req: NextRequest, hostname: string): Promise<string | null> {
  const cached = domainCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.slug;
  const configuredOrigin = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://solvantis.com.au';
  const endpoint = new URL('/api/shop/domain/resolve', /^https?:\/\//i.test(configuredOrigin) ? configuredOrigin : `https://${configuredOrigin}`);
  endpoint.searchParams.set('host', hostname);
  try {
    const response = await fetch(endpoint, { headers: { 'x-solvantis-domain-resolver': '1' }, cache: 'no-store' });
    const slug = response.ok ? String((await response.json()).slug ?? '') || null : null;
    domainCache.set(hostname, { slug, expiresAt: Date.now() + (slug ? 300_000 : 60_000) });
    return slug;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/api/') && !req.nextUrl.pathname.startsWith('/_next/')) {
    const hostname = requestHostname(req);
    if (!isPlatformHostname(hostname)) {
      const slug = await resolveCustomDomain(req, hostname);
      if (slug) {
        const publicPrefix = `/shop/${slug}`;
        if (req.nextUrl.pathname === publicPrefix || req.nextUrl.pathname.startsWith(`${publicPrefix}/`)) {
          const canonical = req.nextUrl.clone();
          canonical.pathname = req.nextUrl.pathname.slice(publicPrefix.length) || '/';
          return NextResponse.redirect(canonical, 308);
        }
        if (req.nextUrl.pathname.startsWith('/shop/')) {
          const canonical = req.nextUrl.clone(); canonical.pathname = '/';
          return NextResponse.redirect(canonical, 308);
        }
        const destination = req.nextUrl.clone();
        destination.pathname = `${publicPrefix}${req.nextUrl.pathname === '/' ? '' : req.nextUrl.pathname}`;
        return NextResponse.rewrite(destination);
      }
      const notFound = req.nextUrl.clone(); notFound.pathname = '/404';
      return NextResponse.rewrite(notFound);
    }
  }

  if (WRITE_METHODS.has(req.method) && req.nextUrl.pathname.startsWith('/api/wholesale/')) {
    const previewRaw = req.cookies.get('wholesale_preview_session')?.value;
    if (previewRaw) {
      const preview = await verifyAdminSessionEdge<{ businessId?: string; preview?: { actorUserId?: number; mode?: WholesaleStaffPreviewMode } }>(previewRaw);
      if (preview?.preview?.actorUserId && preview.businessId) {
        if (isWholesalePreviewMutationAllowed(preview.preview.mode ?? 'read_only', req.method, req.nextUrl.pathname)) {
          return NextResponse.next();
        }
        return NextResponse.json(
          { error: 'This action is not available in staff preview.', code: 'wholesale_preview_read_only' },
          { status: 403 },
        );
      }
    }
  }

  const raw = req.cookies.get('marketoir_session')?.value;
  if (!raw) return NextResponse.next(); // unauthenticated — let the route return 401

  if (PUBLIC_AUTH_PATHS.has(req.nextUrl.pathname)) return NextResponse.next();

  let session: { tier?: string } | null;
  try {
    session = await verifyAdminSessionEdge<{ tier?: string }>(raw);
  } catch {
    return NextResponse.json(
      { error: 'Authentication is not configured.' },
      { status: 500 },
    );
  }

  if (!session) {
    const response = req.nextUrl.pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', req.url));
    response.cookies.delete('marketoir_session');
    return response;
  }

  if (!WRITE_METHODS.has(req.method)) return NextResponse.next();

  if (session.tier === 'Advisor' && (
    req.nextUrl.pathname.startsWith('/api/ims/') ||
    req.nextUrl.pathname.startsWith('/api/inventory/')
  )) {
    return NextResponse.json(
      { error: 'Advisor accounts are read-only. You do not have permission to make changes.' },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/',
    '/ims/:path*',
    '/dashboard/:path*',
    '/setup/:path*',
    '/admin/:path*',
    '/pos/:path*',
    '/shop/:path*',
    '/products/:path*',
    '/pages/:path*',
    '/cart',
    '/checkout/:path*',
    '/login',
    '/account',
  ],
};
