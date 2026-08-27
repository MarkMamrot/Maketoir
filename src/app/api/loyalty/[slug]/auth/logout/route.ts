import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { LOYALTY_PORTAL_SESSION_COOKIE } from '@/lib/loyalty/LoyaltyPortalSession';

export async function POST(_: Request, { params }: { params: { slug: string } }) {
  cookies().set(LOYALTY_PORTAL_SESSION_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', expires: new Date(0), path: '/' });
  return NextResponse.json({ success: true });
}