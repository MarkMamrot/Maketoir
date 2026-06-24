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

  // Ownership check: only allow closing a session that belongs to this device's
  // location (and register, when the cookie carries one). Prevents one terminal
  // from closing another store's/register's session by guessing a session id.
  const target = await PosRegisterSessionRepo.getById(sessionId);
  if (!target) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });

  const deviceLocationId = Number(session.location_id);
  if (deviceLocationId && Number(target.location_id) !== deviceLocationId) {
    return NextResponse.json({ error: 'This session belongs to another location.' }, { status: 403 });
  }
  const deviceRegisterId = Number(session.register_id);
  if (deviceRegisterId && Number(target.register_id) !== deviceRegisterId) {
    return NextResponse.json({ error: 'This session belongs to another register.' }, { status: 403 });
  }

  // Guard against double-close overwriting the original closed_at / closed_by.
  if (target.status === 'closed') {
    return NextResponse.json({ error: 'This session is already closed.' }, { status: 409 });
  }

  const now = new Date().toLocaleString('sv-SE', { timeZone: process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney' }).replace('T', ' ');
  await PosRegisterSessionRepo.close(sessionId, now, session.full_name || session.username || null);

  return NextResponse.json({ success: true });
}
