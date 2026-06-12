import { NextRequest, NextResponse } from 'next/server';
import { getImportSession } from '@/app/api/ims/import/_helpers';
import { ImsStocktakeRepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getImportSession();
    const id = parseInt(params.id, 10);
    const result = await ImsStocktakeRepo.applyToStock(id);

    // EVENT-DRIVEN CACHE UPDATE: Refresh for variants affected by this stocktake
    const stocktake = await ImsStocktakeRepo.get(id);
    if (stocktake && stocktake.items?.length > 0) {
      const vids = stocktake.items.map(i => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for Stocktake:', err));
      }
    }

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
