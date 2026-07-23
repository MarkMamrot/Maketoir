import { NextResponse } from 'next/server';
import { ImsLocationsRepo } from '@/lib/ims/ImsRepository';
import { getImsSession } from '@/lib/auth/imsSession';
import bcrypt from 'bcryptjs';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsLocationsRepo.get(Number(params.id), businessId);
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const existing = await ImsLocationsRepo.get(Number(params.id), businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const body = await req.json();

    // Manager PIN: never write plaintext. `manager_pin` (new/changed value) is
    // hashed here; `clear_manager_pin` removes it. Neither is a real column.
    const updateData: any = { ...body };
    delete updateData.manager_pin;
    delete updateData.clear_manager_pin;
    delete updateData.manager_pin_hash; // never accept a pre-hashed value from the client
    if (typeof body.manager_pin === 'string' && body.manager_pin.trim()) {
      const pin = body.manager_pin.trim();
      if (!/^\d{4,8}$/.test(pin)) {
        return NextResponse.json({ success: false, error: 'Manager PIN must be 4-8 digits.' }, { status: 400 });
      }
      updateData.manager_pin_hash = await bcrypt.hash(pin, 10);
    } else if (body.clear_manager_pin) {
      updateData.manager_pin_hash = null;
    }

    await ImsLocationsRepo.update(Number(params.id), updateData);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const existing = await ImsLocationsRepo.get(Number(params.id), businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    await ImsLocationsRepo.delete(Number(params.id));
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
