import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsProductsRepo, ImsVariantsRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsProductsRepo.get(params.id, businessId);
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const existing = await ImsProductsRepo.get(params.id, businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const body = await req.json();
    const { variants, ...productData } = body;
    await ImsProductsRepo.update(params.id, productData);
    if (variants) {
      for (const v of variants) {
        if (v.variant_id) {
          await ImsVariantsRepo.update(v.variant_id, v);
        } else {
          await ImsVariantsRepo.create({ ...v, product_id: params.id });
        }
      }
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const existing = await ImsProductsRepo.get(params.id, businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    await ImsProductsRepo.delete(params.id);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
