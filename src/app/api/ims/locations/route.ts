import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsLocationsRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const data = await ImsLocationsRepo.list();
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json();
    const id = await ImsLocationsRepo.create(body);
    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
