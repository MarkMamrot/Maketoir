import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosRegisterSessionRepo } from '@/lib/db/PosRepository';

function getAnySession() {
  const raw = cookies().get('pos_session')?.value ?? cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// GET /api/pos/register/session?register_id=X — get currently open session for a register
export async function GET(req: NextRequest) {
  if (!getAnySession()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const registerId = parseInt(searchParams.get('register_id') ?? '', 10);
  if (!registerId) return NextResponse.json({ error: 'register_id required.' }, { status: 400 });
  const session = await PosRegisterSessionRepo.getCurrent(registerId);
  return NextResponse.json({ session });
}
