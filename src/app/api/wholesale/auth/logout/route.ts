import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { WHOLESALE_SESSION_COOKIE } from '@/lib/wholesale/wholesaleSession';

/** POST /api/wholesale/auth/logout — clears the wholesale session cookie. */
export async function POST() {
  cookies().set(WHOLESALE_SESSION_COOKIE, '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   0,
    path:     '/',
  });
  return NextResponse.json({ success: true });
}
