import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { isBuildFromSaleEnabled, planBuildFromSaleShortfalls } from '@/lib/ims/builds/buildFromSalePolicy';
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
    const settingKey = `build_from_sale_location:${Number(order.location_id)}`;
    const settingRows = await imsQuery<{ key: string; value: string }>('SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` IN (?, ?)', [session.businessId, 'build_from_sale_enabled', settingKey]);
    const settings = new Map(settingRows.map(row => [row.key, row.value]));
    if (!isBuildFromSaleEnabled(settings.get('build_from_sale_enabled'), settings.get(settingKey))) return NextResponse.json({ success: true, data: { eligible: false, reason: 'policy_disabled' } });
    const items = await imsQuery<any>(`SELECT item.id, item.variant_id, item.qty_ordered, item.qty_fulfilled, product.name AS product_name, variant.sku, recipe_version.revision
      FROM ims_sales_order_items item
      JOIN ims_product_variants variant ON variant.variant_id = item.variant_id AND variant.business_id = item.business_id
      JOIN ims_products product ON product.product_id = variant.product_id AND product.business_id = item.business_id AND product.is_stock_item = 1
      JOIN ims_product_build_recipes recipe ON recipe.output_variant_id = item.variant_id AND recipe.business_id = item.business_id AND recipe.is_enabled = 1
      JOIN ims_product_build_recipe_versions recipe_version ON recipe_version.id = recipe.active_version_id AND recipe_version.business_id = recipe.business_id
      WHERE item.business_id = ? AND item.so_id = ? ORDER BY item.id`, [session.businessId, soId]);
    const requested = new Map<number, number>((Array.isArray(body.shipmentQuantities) ? body.shipmentQuantities : []).map((line: any) => [Number(line.itemId), Number(line.quantity)]));
    const lines = items.map(item => ({ variantId: String(item.variant_id), quantity: mode === 'fulfil' ? Number(requested.get(Number(item.id)) ?? 0) : Math.max(0, Number(item.qty_ordered)), sourceLineId: String(item.id) })).filter(line => line.quantity > 0);
    const ids = [...new Set(lines.map(line => line.variantId))];
    const stockRows = ids.length ? await imsQuery<any>(`SELECT variant_id, qty_on_hand, qty_committed FROM ims_stock WHERE business_id = ? AND location_id = ? AND variant_id IN (${ids.map(() => '?').join(',')})`, [session.businessId, order.location_id, ...ids]) : [];
    const stock = new Map(stockRows.map(row => [String(row.variant_id), { onHand: Number(row.qty_on_hand), committed: Number(row.qty_committed) }]));
    const usable = new Map(ids.map(id => { const row = stock.get(id) ?? { onHand: 0, committed: 0 }; return [id, mode === 'fulfil' ? row.onHand : Math.max(0, row.onHand - row.committed)] as const; }));
    const planned = planBuildFromSaleShortfalls(lines, usable);
    if (!planned.length) return NextResponse.json({ success: true, data: { eligible: false, reason: 'no_shortfall' } });
    const builds = planned.map(item => ({ outputVariantId: item.outputVariantId, quantity: item.shortfall, sourceLineId: item.sourceLineIds[0], recipeRevision: Number(items.find(line => String(line.variant_id) === item.outputVariantId)?.revision) }));
    const preview = await previewProductBuildBatch({ businessId: session.businessId, locationId: Number(order.location_id), builds, sourceType: 'sales_order', sourceId: String(soId), sourceChannel: String(order.sales_channel ?? order.so_type ?? 'sales_order'), actorId: session.userId, actorName: session.name ?? session.email });
    return NextResponse.json({ success: true, data: { eligible: preview.canComplete, builds, preview, lines: items.filter(item => planned.some(candidate => candidate.outputVariantId === String(item.variant_id))).map(item => ({ itemId: Number(item.id), productName: item.product_name, sku: item.sku })) } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}