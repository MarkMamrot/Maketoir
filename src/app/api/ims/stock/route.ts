import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsStockRepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { parseValuationOwnership, ValuationDateError } from '@/lib/ims/inventoryValuation';


export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const { searchParams } = new URL(req.url);
    const ownership = parseValuationOwnership(searchParams.get('ownership') ?? 'all');
    const variantId  = searchParams.get('variant_id') ?? undefined;
    const locationId = searchParams.get('location_id') ? Number(searchParams.get('location_id')) : undefined;
    const rows = await runImsForBusiness(businessId, () => ImsStockRepo.list(variantId, locationId, businessId));
    const data = ownership === 'all' ? rows : rows.filter(row =>
      (Number(row.is_consignment ?? 0) === 1) === (ownership === 'consignment'));
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if (error instanceof ValuationDateError) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    await reportRuntimeIssue({ businessId, source: 'ims-stock', operation: 'load_stock', title: 'Stock levels failed to load', error });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Stock levels could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json();
    const { variant_id, location_id, ...rest } = body;
    await runImsForBusiness(session.businessId, () => ImsStockRepo.upsert(variant_id, Number(location_id), rest));

    // EVENT-DRIVEN CACHE UPDATE: Refresh for explicit manual stock update
    if (variant_id) {
      void runImsForBusiness(session.businessId, () => refreshVariantCache([variant_id])).catch(error =>
        reportRuntimeIssue({
          businessId: session.businessId, source: 'ims-stock', operation: 'refresh_variant_cache',
          title: 'Stock update saved but product cache refresh failed', error,
          reference: { type: 'variant', id: String(variant_id) },
        }));
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    await reportRuntimeIssue({ businessId: session.businessId, source: 'ims-stock', operation: 'update_stock', title: 'Stock update failed', error });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Stock could not be updated.' }, { status: 500 });
  }
}
