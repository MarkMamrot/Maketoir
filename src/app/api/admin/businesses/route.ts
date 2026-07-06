/**
 * GET  /api/admin/businesses       — list all businesses (SuperAdmin only)
 * POST /api/admin/businesses        — create business
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query, execute } from '@/services/MySQLService';

function getSuperAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return s?.tier === 'SuperAdmin' ? s : null;
  } catch { return null; }
}

export async function GET() {
  if (!getSuperAdminSession()) return NextResponse.json({ error: 'SuperAdmin access required.' }, { status: 403 });
  const rows = await query<any>(
    `SELECT business_id, name, drive_folder_id, has_foresight, has_ims, has_pos, created_at, deleted_at
     FROM businesses ORDER BY name`,
  );
  return NextResponse.json({ success: true, businesses: rows });
}

export async function POST(req: Request) {
  if (!getSuperAdminSession()) return NextResponse.json({ error: 'SuperAdmin access required.' }, { status: 403 });
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  // Use name as a simple slug-style ID (can be changed later)
  const id = `biz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await execute(
    `INSERT INTO businesses (business_id, name, has_foresight, has_ims, has_pos) VALUES (?, ?, 1, 1, 1)`,
    [id, name.trim()],
  );
  return NextResponse.json({ success: true, business_id: id });
}
