import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosRegistersRepo } from '@/lib/db/PosRepository';
import { getImsSession } from '@/lib/auth/imsSession';

function getAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// PUT /api/pos/registers/[id] — update name, default_float, is_active, or card terminal settings
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!getAdminSession()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['marketoir_session']);
  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  const body = await req.json();
  await PosRegistersRepo.update(id, {
    name:                   body.name,
    default_float:          body.default_float          !== undefined ? Number(body.default_float) : undefined,
    is_active:              body.is_active              !== undefined ? Number(body.is_active)      : undefined,
    card_terminal_provider: body.card_terminal_provider !== undefined ? (body.card_terminal_provider || null) : undefined,
    zeller_site_id:         body.zeller_site_id         !== undefined ? (body.zeller_site_id  || null) : undefined,
    zeller_terminal_id:     body.zeller_terminal_id     !== undefined ? (body.zeller_terminal_id || null) : undefined,
    zeller_api_key:         body.zeller_api_key         !== undefined ? (body.zeller_api_key   || null) : undefined,
    card_terminal_methods:  body.card_terminal_methods  !== undefined ? (body.card_terminal_methods || null) : undefined,
  });
  const register = await PosRegistersRepo.get(id);
  return NextResponse.json({ success: true, register });
}
