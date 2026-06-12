import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosUsersRepo } from '@/lib/db/PosRepository';

function requireAdmin() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  if (!requireAdmin()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  try {
    const body = await req.json();
    await PosUsersRepo.update(id, body);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('POS user update error:', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!requireAdmin()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
  await PosUsersRepo.update(id, { is_active: 0 });
  return NextResponse.json({ success: true });
}
