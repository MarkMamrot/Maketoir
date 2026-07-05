/**
 * GET  /api/dashboard/brand-assets?category=models  — list assets
 * POST /api/dashboard/brand-assets                  — create asset
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query, execute } from '@/services/MySQLService';

export async function GET(req: Request) {
  const sessionCookie = cookies().get('marketoir_session');
  if (!sessionCookie?.value) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let session: any;
  try { session = JSON.parse(sessionCookie.value); } catch { return NextResponse.json({ error: 'Unauthorised' }, { status: 401 }); }
  const biz: string = session.businessId ?? session.databaseId ?? '';
  const category = new URL(req.url).searchParams.get('category') ?? '';

  const rows = await query<any>(
    `SELECT id, category, name, content, notes, image_data, image_mime, created_at
     FROM brand_assets
     WHERE business_id = ? ${category ? 'AND category = ?' : ''} AND is_active = 1
     ORDER BY created_at DESC`,
    category ? [biz, category] : [biz],
  );
  return NextResponse.json({ success: true, assets: rows });
}

export async function POST(req: Request) {
  const sessionCookie = cookies().get('marketoir_session');
  if (!sessionCookie?.value) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let session: any;
  try { session = JSON.parse(sessionCookie.value); } catch { return NextResponse.json({ error: 'Unauthorised' }, { status: 401 }); }
  const biz: string = session.businessId ?? session.databaseId ?? '';
  const { category, name, content, notes, imageData, imageMime } = await req.json();
  if (!category || !name?.trim()) {
    return NextResponse.json({ error: 'category and name are required' }, { status: 400 });
  }
  const res = await execute(
    `INSERT INTO brand_assets (business_id, category, name, content, notes, image_data, image_mime) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [biz, category, name.trim(), (content ?? '').trim(), notes?.trim() ?? null, imageData ?? null, imageMime ?? null],
  );
  return NextResponse.json({ success: true, id: res.insertId });
}
