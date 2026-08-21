import { NextResponse } from 'next/server';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';

/** GET /api/wholesale/auth/me — returns the current wholesale session. */
export async function GET() {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  return NextResponse.json({ session });
}
