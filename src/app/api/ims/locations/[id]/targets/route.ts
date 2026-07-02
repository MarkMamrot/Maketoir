import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function getSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const locationId = Number(params.id);
  const raw = await ConfigRepository.get(session.businessId ?? 'shared', `POS_SalesTarget_${locationId}`).catch(() => null);
  let targets: Record<string, number> = {};
  if (raw) { try { targets = JSON.parse(raw); } catch {} }
  return NextResponse.json({ targets });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const locationId = Number(params.id);
  const body = await req.json();
  const targets: Record<string, number> = {};
  for (const day of DAYS) {
    const val = parseInt(String(body.targets?.[day] ?? 0), 10);
    if (val > 0) targets[day] = val;
  }
  await ConfigRepository.set(
    session.businessId ?? 'shared',
    `POS_SalesTarget_${locationId}`,
    JSON.stringify(targets),
  );
  return NextResponse.json({ success: true, targets });
}
