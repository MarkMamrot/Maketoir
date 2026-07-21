import { NextRequest, NextResponse } from 'next/server';
import { getImportSession } from '@/app/api/ims/import/_helpers';
import { ImsStocktakeRepo } from '@/lib/ims/ImsRepository';

export async function GET() {
  try {
    const session = await getImportSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const list = await ImsStocktakeRepo.list(session.businessId);
    return NextResponse.json(list);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getImportSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const body = await req.json();
    const { reference, location_id, notes, blank, brand_id, supplier_id, product_type } = body;
    if (!reference || !location_id) {
      return NextResponse.json({ error: 'reference and location_id are required' }, { status: 400 });
    }
    const id = await ImsStocktakeRepo.create({ reference, location_id, notes, blank: !!blank, brand_id, supplier_id, product_type }, session.businessId);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
