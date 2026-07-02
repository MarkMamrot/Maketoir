import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function getSession() {
  const raw = cookies().get('pos_session')?.value ?? cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ target: null });
  const locationId = session.location_id;
  const bizId = session.businessId ?? 'shared';
  if (!locationId) return NextResponse.json({ target: null });

  const raw = await ConfigRepository.get(bizId, `POS_SalesTarget_${locationId}`).catch(() => null);
  if (!raw) return NextResponse.json({ target: null });

  let targets: Record<string, number> = {};
  try { targets = JSON.parse(raw); } catch {}

  const dayName = DAY_NAMES[new Date().getDay()];
  const target = targets[dayName] ?? null;
  return NextResponse.json({ target: target && target > 0 ? target : null });
}
