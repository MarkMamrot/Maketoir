import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { planBuildFromSaleShortfalls, resolveBuildFromSalePolicy } from '@/lib/ims/builds/buildFromSalePolicy';
import { previewProductBuildBatch } from '@/lib/ims/builds/buildService';
import { imsQuery } from '@/services/IMSMySQLService';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const soId = Number(params.id);
  if (!Number.isInteger(soId) || soId <= 0) return NextResponse.json({ error: 'Invalid sales order ID.' }, { status: 400 });
  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === 'fulfil' ? 'fulfil' : 'confirm';
    const orders = await imsQuery<any>('SELECT id, status, location_id, sales_channel, so_type FROM ims_sales_orders WHERE business_id = ? AND id = ? LIMIT 1', [session.businessId, soId]);
    const order = orders[0];
    if (!order) return NextResponse.json({ error: 'Sales order not found.' }, { status: 404 });
    const policy = await resolveBuildFromSalePolicy(session.businessId, Number(order.location_id));
    if (!policy.enabled) return NextResponse.json({ success: true, data: { eligible: false, reason: 'policy_disabled' } });
    const items = await imsQuery<any>(`SELECT item.id, item.variant_id, item.qty_ordered, item.qty_fulfilled, product.name AS product_name, variant.sku, recipe_version.revision
      FROM ims_sales_order_items item
      JOIN ims_product_variants variant ON variant.variant_id = item.variant_id AND variant.business_id = item.business_id
      JOIN ims_products product ON product.product_id = variant.product_id AND product.business_id = item.business_id AND product.is_stock_item = 1 AND product.uses_builds = 1
      JOIN ims_product_build_recipes recipe ON recipe.output_variant_id = item.variant_id AND recipe.business_id = item.business_id AND recipe.is_enabled = 1
      JOIN ims_product_build_recipe_versions recipe_version ON recipe_version.id = recipe.active_version_id AND recipe_version.business_id = recipe.business_id
      WHERE item.business_id = ? AND item.so_id = ? ORDER BY item.id`, [session.businessId, soId]);
    const requested = new Map<number, number>((Array.isArray(body.shipmentQuantities) ? body.shipmentQuantities : []).map((line: any) => [Number(line.itemId), Number(line.quantity)]));
    const lines = items.map(item => ({ variantId: String(item.variant_id), quantity: mode === 'fulfil' ? Number(requested.get(Number(item.id)) ?? 0) : Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled)), sourceLineId: String(item.id) })).filter(line => line.quantity > 0);
    const ids = [...new Set(lines.map(line => line.variantId))];
    const stockRows = ids.length ? await imsQuery<any>(`SELECT variant_id, qty_on_hand, qty_committed FROM ims_stock WHERE business_id = ? AND location_id = ? AND variant_id IN (${ids.map(() => '?').join(',')})`, [session.businessId, order.location_id, ...ids]) : [];
    const stock = new Map(stockRows.map(row => [String(row.variant_id), { onHand: Number(row.qty_on_hand), committed: Number(row.qty_committed) }]));
    const requestedByVariant = new Map<string, number>();
    for (const line of lines) requestedByVariant.set(line.variantId, (requestedByVariant.get(line.variantId) ?? 0) + line.quantity);
    const usable = new Map(ids.map(id => {
      const row = stock.get(id) ?? { onHand: 0, committed: 0 };
      const ownCommitment = ['confirmed', 'partially_fulfilled'].includes(String(order.status)) ? (requestedByVariant.get(id) ?? 0) : 0;
      const competingCommitment = Math.max(0, row.committed - ownCommitment);
      return [id, mode === 'fulfil' ? row.onHand : Math.max(0, row.onHand - competingCommitment)] as const;
    }));
    const planned = planBuildFromSaleShortfalls(lines, usable);
    const lineDetails = items.filter(item => requestedByVariant.has(String(item.variant_id))).map(item => ({ itemId: Number(item.id), variantId: String(item.variant_id), productName: item.product_name, sku: item.sku }));
    if (!planned.length) {
      const availability = [...requestedByVariant].map(([outputVariantId, requestedQuantity]) => ({
        outputVariantId,
        requestedQuantity,
        readyQuantity: requestedQuantity,
        buildableQuantity: 0,
        unavailableQuantity: 0,
        productName: lineDetails.find(line => line.variantId === outputVariantId)?.productName ?? outputVariantId,
        sku: lineDetails.find(line => line.variantId === outputVariantId)?.sku ?? null,
      }));
      return NextResponse.json({ success: true, data: { eligible: false, reason: 'no_shortfall', availability, lines: lineDetails } });
    }
    const builds = planned.map(item => ({ outputVariantId: item.outputVariantId, quantity: item.shortfall, requestedQuantity: item.requestedQuantity, usableFinishedQuantity: item.usableFinishedQuantity, sourceLineId: item.sourceLineIds[0], recipeRevision: Number(items.find(line => String(line.variant_id) === item.outputVariantId)?.revision) }));
    const preview = await previewProductBuildBatch({ businessId: session.businessId, locationId: Number(order.location_id), builds, sourceType: 'sales_order', sourceId: String(soId), sourceChannel: String(order.sales_channel ?? order.so_type ?? 'sales_order'), actorId: session.userId, actorName: session.name ?? session.email });
    const previewByOutput = new Map(preview.builds.map(item => [item.outputVariantId, item]));
    const availability = [...requestedByVariant].map(([outputVariantId, requestedQuantity]) => {
      const plannedOutput = planned.find(item => item.outputVariantId === outputVariantId);
      const previewOutput = previewByOutput.get(outputVariantId);
      const shortfall = plannedOutput?.shortfall ?? 0;
      return {
        outputVariantId,
        requestedQuantity,
        readyQuantity: Math.max(0, requestedQuantity - shortfall),
        buildableQuantity: previewOutput?.buildableQuantity ?? 0,
        unavailableQuantity: previewOutput?.unavailableQuantity ?? 0,
        productName: lineDetails.find(line => line.variantId === outputVariantId)?.productName ?? outputVariantId,
        sku: lineDetails.find(line => line.variantId === outputVariantId)?.sku ?? null,
      };
    });
    const executableBuilds = builds.map(item => ({ ...item, buildableQuantity: previewByOutput.get(item.outputVariantId)?.buildableQuantity ?? 0, unavailableQuantity: previewByOutput.get(item.outputVariantId)?.unavailableQuantity ?? item.quantity }));
    return NextResponse.json({ success: true, data: { eligible: preview.canComplete, builds: executableBuilds, availability, preview, lines: lineDetails } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}