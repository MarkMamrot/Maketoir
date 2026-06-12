import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosReportsRepo } from '@/lib/db/PosRepository';

function getAnySession() {
  const raw = cookies().get('pos_session')?.value ?? cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// GET /api/pos/reports/graph?location_id=3&days=30
export async function GET(req: Request) {
  if (!getAnySession()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const session = getAnySession();
  const locationId = parseInt(searchParams.get('location_id') ?? String(session?.location_id ?? 0), 10);
  const days = Math.min(parseInt(searchParams.get('days') ?? '30', 10), 365);

  if (!locationId) return NextResponse.json({ error: 'location_id required.' }, { status: 400 });

  const data = await PosReportsRepo.graphData(locationId, days);
  return NextResponse.json({ data });
}
