import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosRegisterSessionRepo } from '@/lib/db/PosRepository';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// POST /api/pos/register/close — close the current register session
// Body: { session_id }
export async function POST(req: NextRequest) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  const body = await req.json();
  const sessionId = Number(body.session_id);
  if (!sessionId) return NextResponse.json({ error: 'session_id required.' }, { status: 400 });

  const now = new Date().toLocaleString('sv-SE', { timeZone: process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney' }).replace('T', ' ');
  await PosRegisterSessionRepo.close(sessionId, now, session.full_name || session.username || null);

  return NextResponse.json({ success: true });
}
