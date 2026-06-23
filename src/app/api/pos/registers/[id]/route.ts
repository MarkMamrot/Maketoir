import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosRegistersRepo } from '@/lib/db/PosRepository';

function getAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// PUT /api/pos/registers/[id] — update name, default_float, or is_active
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!getAdminSession()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  const body = await req.json();
  await PosRegistersRepo.update(id, {
    name:          body.name,
    default_float: body.default_float !== undefined ? Number(body.default_float) : undefined,
    is_active:     body.is_active     !== undefined ? Number(body.is_active)     : undefined,
  });
  const register = await PosRegistersRepo.get(id);
  return NextResponse.json({ success: true, register });
}
