import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosUsersRepo } from '@/lib/db/PosRepository';

function requireAdmin() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function GET() {
  if (!requireAdmin()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const users = await PosUsersRepo.list();
  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  if (!requireAdmin()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  try {
    const body = await req.json();
    const { username, password, full_name, email, phone, branch_ids } = body;
    if (!username || !password) {
      return NextResponse.json({ error: 'username and password are required.' }, { status: 400 });
    }
    const id = await PosUsersRepo.create({ username, password, full_name, email, phone, branch_ids });
    return NextResponse.json({ success: true, id });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'Username already exists.' }, { status: 409 });
    }
    console.error('POS user create error:', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
