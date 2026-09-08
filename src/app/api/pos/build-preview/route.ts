import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import {
  planBuildFromSaleShortfalls,
  resolveBuildFromSalePolicy,
} from '@/lib/ims/builds/buildFromSalePolicy';
import { previewProductBuildBatch, ProductBuildConflictError } from '@/lib/ims/builds/buildService';
import { ProductBuildValidationError } from '@/lib/ims/builds/domain';
import { imsQuery } from '@/services/IMSMySQLService';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function POST(req: Request) {
  const posSession = getPosSession();
  if (!posSession) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const session = await getImsSession(['pos_session']);
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  try {
    const body = await req.json();
    const businessId = String(posSession.businessId ?? session.businessId ?? '');
    const locationId = Number(body.location_id ?? posSession.location_id);
    if (!businessId || !Number.isInteger(locationId) || locationId <= 0
      || Number(posSession.location_id) !== locationId) {
      return NextResponse.json({ error: 'A valid POS location is required.' }, { status: 400 });
    }
    if (body.is_training === true) {
      return NextResponse.json({ error: 'Training Mode cannot build stock.', code: 'pos_build_training_blocked' }, { status: 409 });
    }
    const policy = await resolveBuildFromSalePolicy(businessId, locationId);
    if (!policy.enabled) {
      return NextResponse.json({ error: 'Build from sale is not enabled at this location.', code: 'pos_build_policy_disabled' }, { status: 409 });
    }

    const lines = (Array.isArray(body.items) ? body.items : [])
      .filter((item: any) => item?.variant_id && !item?.is_gift_card && Number(item?.qty) > 0)
      .map((item: any) => ({ variantId: String(item.variant_id), quantity: Number(item.qty) }));
    if (!lines.length) return NextResponse.json({ error: 'At least one stock item is required.' }, { status: 400 });
    const variantIds = [...new Set(lines.map(line => line.variantId))];
    const [stockRows, recipeRows] = await Promise.all([
      imsQuery<{ variant_id: string; qty_on_hand: number }>(
        `SELECT variant_id, qty_on_hand FROM ims_stock
          WHERE business_id = ? AND location_id = ? AND variant_id IN (${variantIds.map(() => '?').join(',')})`,
        [businessId, locationId, ...variantIds],
      ),
      imsQuery<{ output_variant_id: string }>(
        `SELECT output_variant_id FROM ims_product_build_recipes
          WHERE business_id = ? AND is_enabled = 1 AND output_variant_id IN (${variantIds.map(() => '?').join(',')})`,
        [businessId, ...variantIds],
      ),
    ]);
    const shortfalls = planBuildFromSaleShortfalls(
      lines,
      new Map(stockRows.map(row => [String(row.variant_id), Number(row.qty_on_hand)])),
    );
    const recipeVariantIds = new Set(recipeRows.map(row => String(row.output_variant_id)));
    const candidates = shortfalls.filter(item => recipeVariantIds.has(item.outputVariantId));
    if (!candidates.length) {
      return NextResponse.json({
        success: true,
        policy,
        shortfalls,
        buildable: false,
        unbuildableShortfalls: shortfalls,
        preview: null,
      });
    }
    const preview = await previewProductBuildBatch({
      businessId,
      locationId,
      builds: candidates.map(item => ({ outputVariantId: item.outputVariantId, quantity: item.shortfall })),
      sourceType: 'pos_sale',
      sourceChannel: 'pos',
    });
    return NextResponse.json({
      success: true,
      policy,
      shortfalls,
      buildable: preview.canComplete,
      unbuildableShortfalls: shortfalls.filter(item => !recipeVariantIds.has(item.outputVariantId)),
      preview,
    });
  } catch (error) {
    const status = error instanceof ProductBuildValidationError ? 400
      : error instanceof ProductBuildConflictError ? 409 : 500;
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof ProductBuildConflictError ? { code: error.code, ...error.details } : {}),
    }, { status });
  }
}