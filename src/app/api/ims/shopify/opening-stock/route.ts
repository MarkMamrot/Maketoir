import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { ImsShopifyRepo, ImsStocktakeRepo } from '@/lib/ims/ImsRepository';
import { hashInventoryDocumentRequest } from '@/lib/ims/inventoryDocumentLifecycle';
import { planOpeningStockLines, resolveOpeningStockLocations } from '@/lib/ims/shopifyOpeningStock';
import { applyStocktake, transitionStocktake } from '@/lib/ims/stocktakes/stocktakeOperations';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

const BATCH_SIZE = 50;

interface LinkedVariant {
  variant_id: string;
  shopify_inventory_item_id: string;
  sku: string | null;
  product_name: string;
}

function validRunId(value: unknown): string | null {
  const runId = String(value ?? '').trim();
  return /^[a-zA-Z0-9-]{8,64}$/.test(runId) ? runId : null;
}

async function loadContext(businessId: string, variantIds?: string[]) {
  const credentials = await getShopifyAdminCredentials(businessId);
  if (!credentials) throw new Error('Shopify not connected.');
  const shopify = new ShopifyService(credentials.shopDomain, credentials.token);
  const [shopifyLocations, solvantisLocations] = await Promise.all([
    shopify.listLocations(),
    imsQuery<{ id: number; name: string; is_active: number }>(
      `SELECT id, name, is_active FROM ims_locations WHERE business_id = ?`,
      [businessId],
    ),
  ]);
  const locations = resolveOpeningStockLocations(shopifyLocations, solvantisLocations.map(location => ({
    id: location.id,
    name: location.name,
    active: location.is_active,
  })));

  let variantsSql = `SELECT v.variant_id, v.shopify_inventory_item_id, v.sku, p.name AS product_name
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = v.business_id
      WHERE v.business_id = ? AND v.is_active = 1
        AND v.shopify_inventory_item_id IS NOT NULL AND v.shopify_inventory_item_id <> ''`;
  const params: unknown[] = [businessId];
  if (variantIds) {
    if (!variantIds.length || variantIds.length > BATCH_SIZE) throw new Error(`Apply batches must contain 1-${BATCH_SIZE} variants.`);
    variantsSql += ` AND v.variant_id IN (${variantIds.map(() => '?').join(',')})`;
    params.push(...variantIds);
  }
  variantsSql += ' ORDER BY v.variant_id';
  const variants = await imsQuery<LinkedVariant>(variantsSql, params);
  if (variantIds && variants.length !== new Set(variantIds).size) {
    throw new Error('One or more variants are no longer linked to Shopify. Preview again before applying.');
  }
  return { shopify, locations, variants };
}

async function loadLines(
  shopify: ShopifyService,
  locations: ReturnType<typeof resolveOpeningStockLocations>,
  variants: LinkedVariant[],
) {
  const levels = await shopify.getInventoryLevels(
    variants.map(variant => variant.shopify_inventory_item_id),
    locations.map(location => location.shopifyLocationId),
  );
  return planOpeningStockLines(
    variants.map(variant => ({
      variantId: variant.variant_id,
      inventoryItemId: String(variant.shopify_inventory_item_id),
      sku: variant.sku,
      productName: variant.product_name,
    })),
    levels,
    locations,
  );
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = String(session.businessId);

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === 'apply' ? 'apply' : 'preview';

    if (mode === 'preview') {
      const offset = Math.max(0, Math.floor(Number(body?.offset ?? 0)));
      const context = await loadContext(businessId);
      const batch = context.variants.slice(offset, offset + BATCH_SIZE);
      const lines = await loadLines(context.shopify, context.locations, batch);
      const locationIds = context.locations.map(location => location.solvantisLocationId);
      const currentRows = batch.length ? await imsQuery<{ variant_id: string; location_id: number; qty_on_hand: number }>(
        `SELECT variant_id, location_id, qty_on_hand FROM ims_stock
          WHERE business_id = ?
            AND variant_id IN (${batch.map(() => '?').join(',')})
            AND location_id IN (${locationIds.map(() => '?').join(',')})`,
        [businessId, ...batch.map(variant => variant.variant_id), ...locationIds],
      ) : [];
      const currentByKey = new Map(currentRows.map(row => [`${row.variant_id}:${row.location_id}`, Number(row.qty_on_hand)]));
      const previewLines = lines.map(line => {
        const current = currentByKey.get(`${line.variantId}:${line.solvantisLocationId}`) ?? 0;
        return { ...line, currentQuantity: current, adjustment: line.quantity - current };
      });
      return NextResponse.json({
        success: true,
        mode,
        offset,
        total_variants: context.variants.length,
        variant_ids: batch.map(variant => variant.variant_id),
        lines: previewLines,
        locations: context.locations,
        has_more: offset + batch.length < context.variants.length,
        next_offset: offset + batch.length,
      });
    }

    const runId = validRunId(body?.run_id);
    const offset = Math.max(0, Math.floor(Number(body?.offset ?? 0)));
    const variantIds = Array.isArray(body?.variant_ids) ? body.variant_ids.map(String) : [];
    if (!runId) return NextResponse.json({ error: 'A valid run_id is required.' }, { status: 400 });
    const context = await loadContext(businessId, variantIds);
    const lines = await loadLines(context.shopify, context.locations, context.variants);
    const stocktakes: Array<{ id: number; location: string; applied: number; variances: number; replayed: boolean }> = [];

    for (const location of context.locations) {
      const reference = `SHOPIFY-OPEN-${runId}-${offset}-${location.name}`.slice(0, 100);
      const existing = await imsQuery<{ id: number; status: string }>(
        `SELECT id, status FROM ims_stocktakes
          WHERE business_id = ? AND location_id = ? AND reference = ?
          ORDER BY id DESC LIMIT 1`,
        [businessId, location.solvantisLocationId, reference],
      );
      let stocktakeId = existing[0]?.id;
      if (!stocktakeId) {
        stocktakeId = await ImsStocktakeRepo.create({
          reference,
          location_id: location.solvantisLocationId,
          notes: `Shopify opening stock import from ${location.name}. Negative Shopify quantities are recorded as zero.`,
          blank: true,
        }, businessId);
      }

      const locationLines = lines.filter(line => line.solvantisLocationId === location.solvantisLocationId);
      if (existing[0]?.status !== 'completed') {
        for (const line of locationLines) {
          await imsExecute(
            `INSERT INTO ims_stocktake_items (stocktake_id, variant_id, expected_qty, counted_qty, notes)
             SELECT ?, v.variant_id, COALESCE(s.qty_on_hand, 0), ?, ?
               FROM ims_product_variants v
               LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ? AND s.business_id = v.business_id
              WHERE v.variant_id = ? AND v.business_id = ?
             ON DUPLICATE KEY UPDATE counted_qty = VALUES(counted_qty), notes = VALUES(notes)`,
            [stocktakeId, line.quantity, line.wasNegative ? 'Shopify quantity was negative and was clamped to zero.' : null,
             location.solvantisLocationId, line.variantId, businessId],
          );
        }
      }

      if (!existing[0] || existing[0].status === 'draft') {
        await transitionStocktake({
          businessId,
          stocktakeId,
          action: 'start',
          context: {
            operationKey: `shopify-opening-start-${runId}-${offset}-${location.solvantisLocationId}`,
            requestHash: await hashInventoryDocumentRequest({}),
            actorId: session.userId,
            actorName: session.name ?? session.email,
          },
        });
      }

      const result = await applyStocktake({
        businessId,
        stocktakeId,
        context: {
          operationKey: `shopify-opening-${runId}-${offset}-${location.solvantisLocationId}`,
          requestHash: await hashInventoryDocumentRequest({
            source: 'shopify', runId, offset, location: location.name,
            quantities: locationLines.map(line => [line.variantId, line.quantity]),
          }),
          actorId: session.userId,
          actorName: session.name ?? session.email,
        },
      });
      stocktakes.push({ id: stocktakeId, location: location.name, applied: result.applied, variances: result.variances, replayed: result.replayed });
    }

    refreshVariantCache(variantIds).catch(error => console.error('Failed to refresh Shopify opening stock cache:', error));
    await ImsShopifyRepo.logAction('reconcile', 'success', `Applied Shopify opening stock batch ${offset}`, businessId, {
      runId, offset, variants: variantIds.length, stocktakes,
    });
    return NextResponse.json({ success: true, mode, stocktakes, variants: variantIds.length });
  } catch (error: any) {
    await reportRuntimeIssue({
      businessId,
      source: 'shopify',
      operation: 'import_opening_stock',
      title: 'Shopify opening stock import failed',
      error,
      context: { safeMessage: String(error?.message ?? 'Unknown error') },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}