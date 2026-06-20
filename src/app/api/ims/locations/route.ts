import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsLocationsRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.userSpreadsheetId as string;
  try {
    const data = await ImsLocationsRepo.list(businessId);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.userSpreadsheetId as string;
  try {
    const body = await req.json();
    const id = await ImsLocationsRepo.create(body, businessId);
    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
