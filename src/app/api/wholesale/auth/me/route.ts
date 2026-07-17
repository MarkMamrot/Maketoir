import { NextResponse } from 'next/server';
import { requireWholesaleSession } from '@/lib/wholesale/wholesaleSession';

/** GET /api/wholesale/auth/me — returns the current wholesale session. */
export async function GET() {
  const { session, response } = requireWholesaleSession();
  if (response) return response;
  return NextResponse.json({ session });
}
