import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

const CONFIG_KEY = 'POS_DefaultFloat';

function getAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function GET() {
  if (!getAdminSession() && !getPosSession()) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }
  try {
    const adminSession = getAdminSession();
    const posSession   = getPosSession();
    const bizId = adminSession?.businessId ?? posSession?.businessId ?? null;
    if (!bizId) return NextResponse.json({ amount: 0 });
    const raw = await ConfigRepository.get(bizId, CONFIG_KEY);
    const amount = raw !== null ? parseFloat(raw) : 0;
    return NextResponse.json({ amount: isNaN(amount) ? 0 : amount });
  } catch {
    return NextResponse.json({ amount: 0 });
  }
}

export async function PUT(req: Request) {
  const adminSession = getAdminSession();
  if (!adminSession) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  try {
    const { amount } = await req.json();
    if (typeof amount !== 'number' || amount < 0) {
      return NextResponse.json({ error: 'amount must be a non-negative number.' }, { status: 400 });
    }
    const bizId = adminSession.businessId ?? 'shared';
    await ConfigRepository.set(bizId, CONFIG_KEY, String(amount));
    return NextResponse.json({ success: true, amount });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
