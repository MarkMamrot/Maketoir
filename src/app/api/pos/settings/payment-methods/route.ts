import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

const CONFIG_KEY = 'POS_PaymentMethods';
const DEFAULT_METHODS = ['Cash', 'Card', 'EFT', 'Gift Card', 'Account'];

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

function getBusinessId(): string | null {
  const admin = getAdminSession();
  if (admin?.businessId) return admin.businessId;
  return null;
}

export async function GET() {
  if (!getAdminSession() && !getPosSession()) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }
  try {
    const adminSession = getAdminSession();
    const posSession   = getPosSession();
    const bizId = adminSession?.businessId ?? posSession?.businessId ?? null;
    if (!bizId) return NextResponse.json({ methods: DEFAULT_METHODS });
    const raw = await ConfigRepository.get(bizId, CONFIG_KEY);
    const methods = raw ? JSON.parse(raw) : DEFAULT_METHODS;
    return NextResponse.json({ methods });
  } catch {
    return NextResponse.json({ methods: DEFAULT_METHODS });
  }
}

export async function PUT(req: Request) {
  const adminSession = getAdminSession();
  if (!adminSession) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const { methods } = await req.json();
  if (!Array.isArray(methods)) return NextResponse.json({ error: 'methods must be an array.' }, { status: 400 });
  const bizId = adminSession.businessId ?? 'shared';
  await ConfigRepository.set(bizId, CONFIG_KEY, JSON.stringify(methods));
  return NextResponse.json({ success: true, methods });
}

