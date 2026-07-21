import { NextResponse } from 'next/server';
import { ImsLocationsRepo } from '@/lib/ims/ImsRepository';
import { getImsSession } from '@/lib/auth/imsSession';

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
    await ImsLocationsRepo.update(Number(params.id), body);
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
