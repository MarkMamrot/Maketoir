import { NextResponse } from 'next/server';
import { ImsBrandsRepo } from '@/lib/ims/ImsRepository';
import { getImsSession } from '@/lib/auth/imsSession';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!await getImsSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    await ImsBrandsRepo.delete(Number(params.id));
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  if (!await getImsSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const { name, website_url } = await req.json();
    if (!name?.trim()) return NextResponse.json({ success: false, error: 'Name required' }, { status: 400 });
    await ImsBrandsRepo.update(Number(params.id), name.trim(), website_url ?? null);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
