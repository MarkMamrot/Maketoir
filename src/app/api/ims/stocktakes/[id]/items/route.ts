import { NextRequest, NextResponse } from 'next/server';
import { getImportSession } from '@/app/api/ims/import/_helpers';
import { ImsStocktakeRepo } from '@/lib/ims/ImsRepository';

type Params = { params: { id: string } };

// GET /api/ims/stocktakes/[id]/items?q=query&location_id=X — search variants to add
export async function GET(req: NextRequest, { params }: Params) {
  try {
    await getImportSession();
    const id         = parseInt(params.id, 10);
    const q          = req.nextUrl.searchParams.get('q') ?? '';
    const locationId = parseInt(req.nextUrl.searchParams.get('location_id') ?? '0', 10);
    if (!q.trim()) return NextResponse.json({ matches: [] });
    const matches = await ImsStocktakeRepo.searchVariants(q.trim(), id, locationId);
    return NextResponse.json({ matches });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// POST /api/ims/stocktakes/[id]/items — add a variant to the stocktake
export async function POST(req: NextRequest, { params }: Params) {
  try {
    await getImportSession();
    const id = parseInt(params.id, 10);
    const { variant_id, location_id } = await req.json();
    if (!variant_id) return NextResponse.json({ error: 'variant_id required' }, { status: 400 });
    const item = await ImsStocktakeRepo.addItem(id, variant_id, location_id ?? 0);
    return NextResponse.json({ item }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
