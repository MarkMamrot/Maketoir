import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyAdminSessionEdge } from '@/lib/auth/adminSessionTokenEdge';

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

export async function middleware(req: NextRequest) {
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
  ],
};
