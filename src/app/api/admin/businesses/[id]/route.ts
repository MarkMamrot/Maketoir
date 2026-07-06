/**
 * GET    /api/admin/businesses/[id]  — get one business
 * PATCH  /api/admin/businesses/[id]  — update name / access flags
 * DELETE /api/admin/businesses/[id]  — soft-delete (requires confirmation token)
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query, execute } from '@/services/MySQLService';

function getSuperAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { const s = JSON.parse(raw); return s?.tier === 'SuperAdmin' ? s : null; } catch { return null; }
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!getSuperAdminSession()) return NextResponse.json({ error: 'SuperAdmin access required.' }, { status: 403 });
  const rows = await query<any>('SELECT * FROM businesses WHERE business_id = ?', [params.id]);
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, business: rows[0] });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!getSuperAdminSession()) return NextResponse.json({ error: 'SuperAdmin access required.' }, { status: 403 });
  const body = await req.json();
  const sets: string[] = [];
  const vals: any[] = [];
  if (body.name !== undefined)         { sets.push('name = ?');         vals.push(body.name.trim()); }
  if (body.has_foresight !== undefined) { sets.push('has_foresight = ?'); vals.push(body.has_foresight ? 1 : 0); }
  if (body.has_ims !== undefined)       { sets.push('has_ims = ?');       vals.push(body.has_ims ? 1 : 0); }
  if (body.has_pos !== undefined)       { sets.push('has_pos = ?');       vals.push(body.has_pos ? 1 : 0); }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  sets.push('updated_at = NOW()');
  vals.push(params.id);
  await execute(`UPDATE businesses SET ${sets.join(', ')} WHERE business_id = ?`, vals);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!getSuperAdminSession()) return NextResponse.json({ error: 'SuperAdmin access required.' }, { status: 403 });
  const { confirmToken } = await req.json();
  if (confirmToken !== 'DELETE BUSINESS') {
    return NextResponse.json({ error: 'Invalid confirmation token.' }, { status: 400 });
  }
  await execute(`UPDATE businesses SET deleted_at = NOW() WHERE business_id = ?`, [params.id]);
  return NextResponse.json({ success: true });
}
