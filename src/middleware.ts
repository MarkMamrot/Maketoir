import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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

export function middleware(req: NextRequest) {
  if (!WRITE_METHODS.has(req.method)) return NextResponse.next();

  const raw = req.cookies.get('marketoir_session')?.value;
  if (!raw) return NextResponse.next(); // unauthenticated — let the route return 401

  let tier = '';
  try { tier = JSON.parse(raw)?.tier ?? ''; } catch { return NextResponse.next(); }

  if (tier === 'Advisor') {
    return NextResponse.json(
      { error: 'Advisor accounts are read-only. You do not have permission to make changes.' },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

export const config = {
  // Only run on the mutating IMS / inventory APIs.
  matcher: ['/api/ims/:path*', '/api/inventory/:path*'],
};
