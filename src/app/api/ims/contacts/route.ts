import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsContactsRepo } from '@/lib/ims/ImsRepository';
import { imsExecute } from '@/services/IMSMySQLService';

let migrationDone = false;
async function ensureMigration() {
  if (migrationDone) return;
  await imsExecute(
    `ALTER TABLE ims_contacts ADD COLUMN IF NOT EXISTS order_frequency_days INT NOT NULL DEFAULT 45`,
  ).catch(() => {});
  migrationDone = true;
}

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.userSpreadsheetId as string;
  try {
    await ensureMigration();
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') as any ?? undefined;
    const activeOnly = searchParams.get('active') === '1';
    const data = await ImsContactsRepo.list(type, activeOnly, businessId);
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
    const id = await ImsContactsRepo.create(body, businessId);
    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
