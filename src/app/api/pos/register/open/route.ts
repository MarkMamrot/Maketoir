import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosRegisterSessionRepo } from '@/lib/db/PosRepository';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// POST /api/pos/register/open — open a register session
// Body: { register_id, location_id, session_date, opening_float, denomination_data }
export async function POST(req: NextRequest) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  const body = await req.json();
  const registerId = Number(body.register_id ?? session.register_id);
  const locationId = Number(body.location_id ?? session.location_id);

  if (!registerId || !locationId) {
    return NextResponse.json({ error: 'register_id and location_id required.' }, { status: 400 });
  }

  // Prevent double-open: close any stale open session first
  const existing = await PosRegisterSessionRepo.getCurrent(registerId);
  if (existing) {
    const now = new Date().toLocaleString('sv-SE', { timeZone: process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney' }).replace('T', ' ');
    await PosRegisterSessionRepo.close(existing.id, now, session.full_name || session.username || null);
  }

  const now = new Date().toLocaleString('sv-SE', { timeZone: process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney' }).replace('T', ' ');
  const sessionDate = body.session_date ?? now.slice(0, 10);

  const sessionId = await PosRegisterSessionRepo.open({
    register_id:      registerId,
    location_id:      locationId,
    session_date:     sessionDate,
    opened_at:        now,
    opened_by:        session.full_name || session.username || null,
    opening_float:    body.opening_float != null ? Number(body.opening_float) : null,
    denomination_data: body.denomination_data ?? null,
  });

  return NextResponse.json({ success: true, session_id: sessionId });
}
