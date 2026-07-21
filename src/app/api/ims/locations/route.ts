import { NextResponse } from 'next/server';
import { ImsLocationsRepo } from '@/lib/ims/ImsRepository';
import { query } from '@/services/MySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsLocationsRepo.list(businessId);
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
    // Enforce max_locations cap
    const [bizRow] = await query<{ max_locations: number | null }>(
      'SELECT max_locations FROM businesses WHERE business_id = ? AND deleted_at IS NULL LIMIT 1',
      [businessId],
    );
    const cap = bizRow?.max_locations ?? null;
    if (cap !== null) {
      const existing = await ImsLocationsRepo.list(businessId);
      if (existing.length >= cap) {
        return NextResponse.json(
          { success: false, error: `Location limit reached. Your plan allows a maximum of ${cap} location${cap !== 1 ? 's' : ''}.` },
          { status: 403 },
        );
      }
    }

    const body = await req.json();
    const id = await ImsLocationsRepo.create(body, businessId);
    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
