import { NextResponse } from 'next/server';
import { clearAdminSessionCookie, clearMfaTrustCookie } from '@/lib/auth/adminAuthCookies';

export async function POST() {
  clearAdminSessionCookie();
  clearMfaTrustCookie();
  return NextResponse.json({ success: true, message: 'Logged out successfully.' });
}
