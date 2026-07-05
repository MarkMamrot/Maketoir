/**
 * DELETE /api/dashboard/brand-assets/[id]  — soft-delete asset
 * PUT    /api/dashboard/brand-assets/[id]  — rename/edit asset
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/services/MySQLService';

function getSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const biz: string = session.businessId ?? session.databaseId ?? '';
  await query('UPDATE brand_assets SET is_active = 0 WHERE id = ? AND business_id = ?', [Number(params.id), biz]);
  return NextResponse.json({ success: true });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const biz: string = session.businessId ?? session.databaseId ?? '';
  const { name, content, notes } = await req.json();
  const sets: string[] = [], vals: any[] = [];
  if (name)    { sets.push('name = ?');    vals.push(name.trim()); }
  if (content) { sets.push('content = ?'); vals.push(content.trim()); }
  if (notes !== undefined) { sets.push('notes = ?'); vals.push(notes?.trim() ?? null); }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  vals.push(Number(params.id), biz);
  await query(`UPDATE brand_assets SET ${sets.join(', ')} WHERE id = ? AND business_id = ?`, vals);
  return NextResponse.json({ success: true });
}
