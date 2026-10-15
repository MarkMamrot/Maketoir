import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { ImsShopifyRepo, ImsStocktakeRepo } from '@/lib/ims/ImsRepository';
import { hashInventoryDocumentRequest } from '@/lib/ims/inventoryDocumentLifecycle';
import { changedOpeningStockVariantIds, planOpeningStockLines, resolveOpeningStockLocations,
  SHOPIFY_INVENTORY_CONFIRMATION, ShopifyOpeningStockValidationError, type OpeningStockMapping } from '@/lib/ims/shopifyOpeningStock';
import { signOpeningStockSnapshot, verifyOpeningStockSnapshot } from '@/lib/ims/shopifyOpeningStockSnapshot';
import { applyStocktake, transitionStocktake } from '@/lib/ims/stocktakes/stocktakeOperations';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
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
    if (!['locations', 'preview', 'apply'].includes(mode)) return NextResponse.json({ error: 'Select a valid inventory import action.' }, { status: 400 });
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
    let snapshot;
    try { snapshot = verifyOpeningStockSnapshot(body?.snapshot, businessId, channelInstanceId); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid preview.' }, { status: 400 }); }
    const offset = snapshot.offset;
    const lines = snapshot.lines;
    const variantIds = [...new Set(lines.map(line => line.variantId))];
    const variants = await imsQuery<{ variant_id: string; external_inventory_id: string }>(
      `SELECT v.variant_id, mapping.external_inventory_id FROM ims_product_variants v
        JOIN ims_products p ON BINARY p.product_id = BINARY v.product_id AND BINARY p.business_id = BINARY v.business_id
        JOIN ims_sales_channel_product_mappings mapping ON BINARY mapping.variant_id = BINARY v.variant_id
          AND BINARY mapping.business_id = BINARY v.business_id
        WHERE v.business_id = ? AND mapping.channel_instance_id = ? AND mapping.mapping_status = 'linked'
          AND v.is_active = 1 AND p.is_active = 1 AND COALESCE(p.is_stock_item, 1) = 1
          AND v.variant_id IN (${variantIds.map(() => '?').join(',')})`,
      [businessId, channelInstanceId, ...variantIds],
    );
    if (variants.length !== variantIds.length || lines.some(line =>
      !variants.some(variant => variant.variant_id === line.variantId && String(variant.external_inventory_id) === line.inventoryItemId))) {
      throw new Error('One or more variants are no longer linked to Shopify. Preview again before applying.');
    }
    const locationIds = [...new Set(lines.map(line => line.solvantisLocationId))];
    const locations = await imsQuery<{ id: number; name: string; is_active: number }>(
      `SELECT id, name, is_active FROM ims_locations
        WHERE business_id = ? AND id IN (${locationIds.map(() => '?').join(',')})`,
      [businessId, ...locationIds],
    );
    const validLocations = new Map(locations
      .filter(location => Number(location.is_active) !== 0)
      .map(location => [Number(location.id), location.name]));
    for (const line of lines) {
      if (validLocations.get(line.solvantisLocationId) !== line.locationName) {
        throw new Error('An opening stock location changed after preview. Preview again before applying.');
      }
    }
    const stocktakes: Array<{ id: number; location: string; applied: number; variances: number; replayed: boolean }> = [];

    for (const location of [...new Map(lines.map(line => [line.solvantisLocationId, {
      name: line.locationName,
      solvantisLocationId: line.solvantisLocationId,
    }])).values()]) {
      const reference = `SHOPIFY-OPEN-${runId}-${offset}-${location.solvantisLocationId}`.slice(0, 100);
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

    await refreshVariantCache(variantIds);
    await ImsShopifyRepo.logAction('reconcile', 'success', `Applied Shopify opening stock batch ${offset}`, businessId, {
      runId, offset, variants: variantIds.length, stocktakes,
    }, channelInstanceId);
    return NextResponse.json({ success: true, mode, stocktakes, variants: variantIds.length });
  } catch (error) {
    if (error instanceof ShopifyOpeningStockValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
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