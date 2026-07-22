import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosRegistersRepo } from '@/lib/db/PosRepository';
import { getImsSession } from '@/lib/auth/imsSession';

function getAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function getAnySession() {
  // Try each cookie in order; skip missing/malformed ones.
  for (const name of ['marketoir_session', 'pos_session']) {
    const raw = cookies().get(name)?.value;
    if (!raw) continue;
    try { const s = JSON.parse(raw); if (s) return s; } catch {}
  }
  return null;
}

// GET /api/pos/registers?location_id=X  — list registers for a location (public for device setup)
// GET /api/pos/registers?all=true       — list ALL registers for the business (admin only)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  if (searchParams.get('all') === 'true') {
    const session = getAdminSession();
    if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
    await getImsSession(['marketoir_session']);
    const registers = await PosRegistersRepo.listAll(session.businessId as string);
    // Mask API key in admin settings view
    return NextResponse.json({ registers: registers.map(r => ({ ...r, zeller_api_key: r.zeller_api_key ? '****' : null })) });
  }

  const locationId = parseInt(searchParams.get('location_id') ?? '', 10);
  if (!locationId || isNaN(locationId)) {
    return NextResponse.json({ error: 'location_id required.' }, { status: 400 });
  }
  const session = getAnySession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  // Prefer marketoir_session for IMS context — if both cookies are present (admin doing device
  // setup while a stale pos_session from a different business is still live), the admin's
  // business is authoritative. An explicit business_id param (sent by DeviceSetup admin flow)
  // bypasses cookie-based resolution entirely.
  const explicitBusinessId = searchParams.get('business_id') ?? null;
  if (explicitBusinessId && getAdminSession()?.businessId === explicitBusinessId) {
    // Admin-scoped request: use the explicit business_id to set IMS context.
    const { enterImsForBusiness } = await import('@/lib/db/BusinessRegistry');
    await enterImsForBusiness(explicitBusinessId);
  } else {
    await getImsSession(['marketoir_session', 'pos_session']);
  }
  const registers = await PosRegistersRepo.listForLocation(locationId);
  return NextResponse.json({ registers });
}

// POST /api/pos/registers — create a new register (admin only)
export async function POST(req: NextRequest) {
  if (!getAdminSession()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['marketoir_session']);
  const body = await req.json();
  const { location_id, name, default_float } = body;
  if (!location_id || !name?.trim()) {
    return NextResponse.json({ error: 'location_id and name required.' }, { status: 400 });
  }
  const id = await PosRegistersRepo.create(Number(location_id), name.trim(), Number(default_float ?? 200));
  const register = await PosRegistersRepo.get(id);
  return NextResponse.json({ success: true, register });
}
