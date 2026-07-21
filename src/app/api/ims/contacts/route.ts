import { NextResponse } from 'next/server';
import { ImsContactsRepo } from '@/lib/ims/ImsRepository';
import { imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

let migrationDone = false;
async function ensureMigration() {
  if (migrationDone) return;
  await imsExecute(
    `ALTER TABLE ims_contacts ADD COLUMN IF NOT EXISTS order_frequency_days INT NOT NULL DEFAULT 45`,
  ).catch(() => {});
  migrationDone = true;
}

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
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
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const body = await req.json();
    const id = await ImsContactsRepo.create(body, businessId);
    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
