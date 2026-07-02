import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosRegistersRepo } from '@/lib/db/PosRepository';

function getAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function getAnySession() {
  const raw = cookies().get('pos_session')?.value ?? cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// GET /api/pos/registers?location_id=X  — list registers for a location (public for device setup)
// GET /api/pos/registers?all=true       — list ALL registers for the business (admin only)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  if (searchParams.get('all') === 'true') {
    const session = getAdminSession();
    if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
    const registers = await PosRegistersRepo.listAll(session.businessId as string);
    // Mask API key in admin settings view
    return NextResponse.json({ registers: registers.map(r => ({ ...r, zeller_api_key: r.zeller_api_key ? '****' : null })) });
  }

  const locationId = parseInt(searchParams.get('location_id') ?? '', 10);
  if (!locationId || isNaN(locationId)) {
    return NextResponse.json({ error: 'location_id required.' }, { status: 400 });
  }
  // Public — device setup calls this before any session exists.
  // Only return the Zeller API key when an authenticated session is present.
  const session = getAnySession();
  const registers = await PosRegistersRepo.listForLocation(locationId);
  const safeRegisters = session
    ? registers
    : registers.map(r => ({ ...r, zeller_api_key: null }));
  return NextResponse.json({ registers: safeRegisters });
}

// POST /api/pos/registers — create a new register (admin only)
export async function POST(req: NextRequest) {
  if (!getAdminSession()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const body = await req.json();
  const { location_id, name, default_float } = body;
  if (!location_id || !name?.trim()) {
    return NextResponse.json({ error: 'location_id and name required.' }, { status: 400 });
  }
  const id = await PosRegistersRepo.create(Number(location_id), name.trim(), Number(default_float ?? 200));
  const register = await PosRegistersRepo.get(id);
  return NextResponse.json({ success: true, register });
}
