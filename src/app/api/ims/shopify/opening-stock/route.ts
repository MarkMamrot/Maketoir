import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';
import { changedOpeningStockVariantIds, planOpeningStockLines, resolveOpeningStockLocations,
  SHOPIFY_INVENTORY_CONFIRMATION, ShopifyOpeningStockValidationError, type OpeningStockMapping } from '@/lib/ims/shopifyOpeningStock';
import { signOpeningStockSnapshot, verifyOpeningStockSnapshot } from '@/lib/ims/shopifyOpeningStockSnapshot';
import { StocktakeOperationConflict } from '@/lib/ims/stocktakes/stocktakeOperations';
import { InventoryDocumentOperationConflict } from '@/lib/ims/inventoryDocumentOperations';
import { applyOpeningStockBatch, prepareOpeningStocktakes } from '@/lib/ims/shopifyOpeningStockApply';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

const PREVIEW_BATCH_SIZE = 50;
const APPLY_BATCH_SIZE = 10;
const SNAPSHOT_TTL_MS = 2 * 60 * 60 * 1000;

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

async function loadLocationContext(businessId: string, channelInstanceId: string) {
  const { credentials } = await getShopifyOperationContext({ businessId, channelInstanceId });
  const shopify = new ShopifyService(credentials.shopDomain, credentials.token);
  const [shopifyLocations, solvantisLocations] = await Promise.all([
    shopify.listLocations(),
    imsQuery<{ id: number; name: string; is_active: number }>(
      `SELECT id, name, is_active FROM ims_locations WHERE business_id = ?`,
      [businessId],
    ),
  ]);
  return { shopify, shopifyLocations, solvantisLocations: solvantisLocations.map(location => ({
    id: location.id,
    name: location.name,
    active: location.is_active,
  })) };
}

async function loadPreviewContext(businessId: string, channelInstanceId: string, mappings: OpeningStockMapping[]) {
  const context = await loadLocationContext(businessId, channelInstanceId);
  const locations = resolveOpeningStockLocations(context.shopifyLocations, context.solvantisLocations, mappings);
  const variantsSql = `SELECT v.variant_id, mapping.external_inventory_id AS shopify_inventory_item_id, v.sku, p.name AS product_name
       FROM ims_product_variants v
       JOIN ims_products p ON BINARY p.product_id = BINARY v.product_id AND BINARY p.business_id = BINARY v.business_id
       JOIN ims_sales_channel_product_mappings mapping ON BINARY mapping.variant_id = BINARY v.variant_id
         AND BINARY mapping.business_id = BINARY v.business_id
      WHERE v.business_id = ? AND mapping.channel_instance_id = ? AND mapping.mapping_status = 'linked'
        AND v.is_active = 1 AND p.is_active = 1 AND COALESCE(p.is_stock_item, 1) = 1
        AND mapping.external_inventory_id IS NOT NULL AND mapping.external_inventory_id <> ''
      ORDER BY v.variant_id`;
  const variants = await imsQuery<LinkedVariant>(variantsSql, [businessId, channelInstanceId]);
  if (new Set(variants.map(variant => variant.shopify_inventory_item_id)).size !== variants.length) {
    throw new Error('Multiple Solvantis variants share a Shopify inventory item. Repair product mappings first.');
  }
  return { shopify: context.shopify, locations, variants };
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
  const disabled = await shopifyDisabledResponse(businessId); if (disabled) return disabled;
  let channelInstanceId = '';

  try {
    const body = await req.json().catch(() => ({}));
    channelInstanceId = String(body?.channelInstanceId ?? '').trim();
    if (!channelInstanceId) return NextResponse.json({ error: 'Select a Shopify storefront.' }, { status: 400 });
    const mode = body?.mode;
    if (!['locations', 'preview', 'prepare', 'apply'].includes(mode)) return NextResponse.json({ error: 'Select a valid inventory import action.' }, { status: 400 });
    if (mode === 'locations') {
      const context = await loadLocationContext(businessId, channelInstanceId);
      return NextResponse.json({ success: true,
        shopifyLocations: context.shopifyLocations.filter(location => location.active),
        solvantisLocations: context.solvantisLocations.filter(location => Number(location.active) !== 0),
      });
    }

    if (mode === 'preview') {
      const offset = Number(body?.offset ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ error: 'Invalid preview offset.' }, { status: 400 });
      const context = await loadPreviewContext(businessId, channelInstanceId, body?.mappings);
      const batchSize = Math.min(PREVIEW_BATCH_SIZE, Math.floor(250 / context.locations.length));
      const batch = context.variants.slice(offset, offset + batchSize);
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
      const changedVariantIds = changedOpeningStockVariantIds(previewLines);
      const applyBatches = [];
      const changedVariants = batch.filter(variant => changedVariantIds.has(variant.variant_id));
      for (let batchOffset = 0; batchOffset < changedVariants.length; batchOffset += APPLY_BATCH_SIZE) {
        const applyVariants = changedVariants.slice(batchOffset, batchOffset + APPLY_BATCH_SIZE);
        const applyVariantIds = new Set(applyVariants.map(variant => variant.variant_id));
        const snapshotLines = previewLines
          .filter(line => applyVariantIds.has(line.variantId))
          .map(line => ({
            variantId: line.variantId,
            locationName: line.locationName,
            solvantisLocationId: line.solvantisLocationId,
            quantity: line.quantity,
            wasNegative: line.wasNegative,
            inventoryItemId: line.inventoryItemId,
          }));
        const applyOffset = offset + batch.findIndex(variant => variant.variant_id === applyVariants[0].variant_id);
        applyBatches.push({
          offset: applyOffset,
          variant_ids: [...applyVariantIds],
          snapshot: signOpeningStockSnapshot({
            version: 2,
            businessId,
            channelInstanceId,
            offset: applyOffset,
            expiresAt: Date.now() + SNAPSHOT_TTL_MS,
            lines: snapshotLines,
          }),
        });
      }
      return NextResponse.json({
        success: true,
        mode,
        offset,
        total_variants: context.variants.length,
        variant_ids: batch.map(variant => variant.variant_id),
        apply_batches: applyBatches,
        lines: previewLines,
        locations: context.locations,
        skipped_levels: batch.length * context.locations.length - lines.length,
        has_more: offset + batch.length < context.variants.length,
        next_offset: offset + batch.length,
      });
    }

    if (body?.confirmation !== SHOPIFY_INVENTORY_CONFIRMATION) {
      return NextResponse.json({ error: `Type ${SHOPIFY_INVENTORY_CONFIRMATION} to apply onboarding inventory.` }, { status: 400 });
    }
    await getShopifyOperationContext({ businessId, channelInstanceId });
    const runId = validRunId(body?.run_id);
    if (!runId) return NextResponse.json({ error: 'A valid run_id is required.' }, { status: 400 });
    const importContext = { businessId, channelInstanceId, runId, actorId: session.userId, actorName: session.name ?? session.email };
    if (mode === 'prepare') {
      if (!Array.isArray(body.snapshots) || !body.snapshots.length || body.snapshots.length > 2000) {
        return NextResponse.json({ error: 'Prepare between 1 and 2,000 preview batches.' }, { status: 400 });
      }
      let snapshots;
      try { snapshots = body.snapshots.map((token: unknown) => verifyOpeningStockSnapshot(token, businessId, channelInstanceId)); }
      catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid preview.' }, { status: 400 }); }
      const stocktakes = await prepareOpeningStocktakes(importContext, snapshots);
      return NextResponse.json({ success: true, mode, stocktakes });
    }
    let snapshot;
    try { snapshot = verifyOpeningStockSnapshot(body?.snapshot, businessId, channelInstanceId); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid preview.' }, { status: 400 }); }
    const variantIds = [...new Set(snapshot.lines.map(line => line.variantId))];
    const stocktakes = await applyOpeningStockBatch(importContext, snapshot);

    await refreshVariantCache(variantIds);
    await ImsShopifyRepo.logAction('reconcile', 'success', `Applied Shopify opening stock batch ${snapshot.offset}`, businessId, {
      runId, offset: snapshot.offset, variants: variantIds.length, stocktakes,
    }, channelInstanceId);
    return NextResponse.json({ success: true, mode, stocktakes, variants: variantIds.length });
  } catch (error) {
    if (error instanceof ShopifyOpeningStockValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof StocktakeOperationConflict || error instanceof InventoryDocumentOperationConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId,
      source: 'shopify',
      operation: 'import_opening_stock',
      title: 'Shopify opening stock import failed',
      error,
      context: { channelInstanceId },
      reference: { type: 'sales_channel_instance', id: channelInstanceId || 'unselected' },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Shopify inventory import failed.' }, { status: 500 });
  }
}