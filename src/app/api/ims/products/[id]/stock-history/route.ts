import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import { enterImsForBusiness } from '@/lib/db/BusinessRegistry';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

// Movement types whose qty_change does NOT affect qty_on_hand — they move
// qty_incoming (on-order) or qty_committed (reserved) instead. Excluded from
// any on-hand balance math (e.g. inferring opening stock).
const NON_ONHAND_MOVEMENT_TYPES = new Set<string>([
  'po_approved',    // → qty_incoming (on order)
  'so_confirmed',   // → qty_committed (reserved)
  'so_committed',   // → qty_committed
  'so_unconfirmed', // → qty_committed (released)
  'so_uncommitted', // → qty_committed
]);

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    await enterImsForBusiness(session.businessId as string);
    const productId = params.id;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutoffStr = cutoff.toISOString().slice(0, 19).replace('T', ' ');

    // Fetch all variants for this product
    const variants = await imsQuery<{
      variant_id: string; sku: string | null;
      option1_value: string | null; option2_value: string | null; option3_value: string | null;
    }>(
      `SELECT variant_id, sku, option1_value, option2_value, option3_value
       FROM ims_product_variants
       WHERE product_id = ?
       ORDER BY id`,
      [productId],
    );

    if (variants.length === 0) {
      return NextResponse.json({
        success: true, variants: [], stockByLocation: [],
        openingBalances: [], movements: [],
        summary: {
          total_in: 0,
          total_out: 0,
          net: 0,
          pos: { in: 0, out: 0, net: 0 },
          online: { in: 0, out: 0, net: 0 },
        },
      });
    }

    const variantIds = variants.map(v => v.variant_id);
    const ph = variantIds.map(() => '?').join(',');

    // Current stock by location
    const stockByLocation = await imsQuery<{
      variant_id: string; location_id: number; location_name: string;
      qty_on_hand: number; qty_incoming: number; qty_committed: number;
    }>(
      `SELECT s.variant_id, s.location_id, l.name AS location_name,
              s.qty_on_hand, s.qty_incoming, s.qty_committed
       FROM ims_stock s
       JOIN ims_locations l ON l.id = s.location_id
       WHERE s.variant_id IN (${ph})
       ORDER BY l.name`,
      variantIds,
    );

    // Opening balance: last movement BEFORE the 12-month cutoff per variant+location
    // (represents stock level at the start of the 12-month window)
    const openingBalancesRaw = await imsQuery<{
      variant_id: string; location_id: number; location_name: string;
      qty_after_soh: number; created_at: string;
    }>(
      `SELECT m.variant_id, m.location_id, l.name AS location_name,
              m.qty_after_soh, m.created_at
       FROM ims_stock_movements m
       JOIN ims_locations l ON l.id = m.location_id
       INNER JOIN (
         SELECT variant_id, location_id, MAX(id) AS max_id
         FROM ims_stock_movements
         WHERE variant_id IN (${ph})
           AND created_at < ?
         GROUP BY variant_id, location_id
       ) latest ON m.id = latest.max_id`,
      [...variantIds, cutoffStr],
    );

    // All movements in the last 12 months with context joins
    const movements = await imsQuery<{
      id: number; variant_id: string; location_id: number; location_name: string;
      movement_type: string; reference_type: string; reference_id: number | null;
      qty_change: number; qty_after_soh: number; unit_cost: number | null;
      notes: string | null; created_at: string;
      po_number: string | null; so_number: string | null;
      shopify_order_id: string | null;
      supplier_name: string | null; customer_name: string | null;
      pos_sale_local_id: string | null;
      committed_change: number;
    }>(
      `SELECT
         m.id, m.variant_id, m.location_id, l.name AS location_name,
         m.movement_type, m.reference_type, m.reference_id,
         m.qty_change, m.qty_after_soh, m.unit_cost, m.notes, m.created_at,
         po.po_number,
         so.so_number,
         so.shopify_order_id,
         sup.name AS supplier_name,
         cust.name AS customer_name,
         ps.local_id AS pos_sale_local_id,
         CASE
           WHEN m.movement_type IN ('so_confirmed','so_committed')     THEN COALESCE(soi.qty, 0)
           WHEN m.movement_type IN ('so_unconfirmed','so_uncommitted') THEN -COALESCE(soi.qty, 0)
           WHEN m.movement_type = 'so_fulfilled'                        THEN m.qty_change
           ELSE 0
         END AS committed_change
       FROM ims_stock_movements m
       JOIN ims_locations l ON l.id = m.location_id
       LEFT JOIN ims_purchase_orders po
         ON po.id = m.reference_id AND m.reference_type = 'purchase_order'
       LEFT JOIN ims_contacts sup ON sup.id = po.supplier_id
       LEFT JOIN ims_sales_orders so
         ON so.id = m.reference_id AND m.reference_type = 'sales_order'
       LEFT JOIN ims_contacts cust ON cust.id = so.customer_id
       LEFT JOIN pos_sales ps
         ON ps.id = m.reference_id AND m.reference_type = 'pos_sale'
       LEFT JOIN (
         SELECT so_id, variant_id, SUM(qty_ordered) AS qty
         FROM ims_sales_order_items
         GROUP BY so_id, variant_id
       ) soi ON soi.so_id = m.reference_id AND soi.variant_id = m.variant_id AND m.reference_type = 'sales_order'
       WHERE m.variant_id IN (${ph})
         AND m.created_at >= ?
       ORDER BY m.created_at DESC`,
      [...variantIds, cutoffStr],
    );

    // Build a complete opening baseline set:
    // 1) Use explicit pre-cutoff movement rows when present.
    // 2) For missing variant/location keys, infer opening from current SOH minus post-cutoff movement deltas.
    const openingByKey = new Map<string, {
      variant_id: string;
      location_id: number;
      location_name: string;
      qty_after_soh: number;
      created_at: string;
      inferred?: boolean;
    }>();

    for (const row of openingBalancesRaw) {
      const key = `${row.variant_id}::${row.location_id}`;
      openingByKey.set(key, { ...row, inferred: false });
    }

    const currentByKey = new Map<string, {
      variant_id: string;
      location_id: number;
      location_name: string;
      qty_on_hand: number;
    }>();
    for (const row of stockByLocation) {
      const key = `${row.variant_id}::${row.location_id}`;
      currentByKey.set(key, {
        variant_id: row.variant_id,
        location_id: row.location_id,
        location_name: row.location_name,
        qty_on_hand: Number(row.qty_on_hand ?? 0),
      });
    }

    const movementDeltaByKey = new Map<string, number>();
    for (const m of movements) {
      // Only movements that actually change qty_on_hand may be used to infer the
      // opening on-hand balance. po_approved (on-order → qty_incoming) and the
      // SO commit/uncommit types (→ qty_committed) carry a qty_change but never
      // touch qty_on_hand, so including them understates/overstates the opening
      // balance (e.g. a +12 po_approved made the opening show as -12).
      if (NON_ONHAND_MOVEMENT_TYPES.has(m.movement_type)) continue;
      const key = `${m.variant_id}::${m.location_id}`;
      movementDeltaByKey.set(key, (movementDeltaByKey.get(key) ?? 0) + Number(m.qty_change ?? 0));
    }

    for (const [key, current] of currentByKey.entries()) {
      if (openingByKey.has(key)) continue;
      const postCutoffDelta = movementDeltaByKey.get(key) ?? 0;
      openingByKey.set(key, {
        variant_id: current.variant_id,
        location_id: current.location_id,
        location_name: current.location_name,
        qty_after_soh: current.qty_on_hand - postCutoffDelta,
        created_at: cutoffStr,
        inferred: true,
      });
    }

    const openingBalances = Array.from(openingByKey.values());

    // Summary totals
    let total_in = 0;
    let total_out = 0;
    let pos_in = 0;
    let pos_out = 0;
    let online_in = 0;
    let online_out = 0;
    for (const m of movements) {
      // Skip on-order/committed movements — they aren't real stock in/out.
      if (NON_ONHAND_MOVEMENT_TYPES.has(m.movement_type)) continue;
      const delta = Number(m.qty_change);
      const isPos = m.reference_type === 'pos_sale' || m.movement_type.startsWith('pos_');
      const isOnline = m.reference_type === 'sales_order' && !!m.shopify_order_id;
      if (delta > 0) total_in += delta;
      else total_out += Math.abs(delta);

      if (isPos) {
        if (delta > 0) pos_in += delta;
        else pos_out += Math.abs(delta);
      }

      if (isOnline) {
        if (delta > 0) online_in += delta;
        else online_out += Math.abs(delta);
      }
    }

    // Attach variant label to each movement
    const variantLabelMap = new Map(
      variants.map(v => [
        v.variant_id,
        [v.option1_value, v.option2_value, v.option3_value].filter(Boolean).join(' / ') ||
          v.sku ||
          v.variant_id,
      ]),
    );

    return NextResponse.json({
      success: true,
      variants: variants.map(v => ({ ...v, label: variantLabelMap.get(v.variant_id) })),
      stockByLocation,
      openingBalances,
      movements: movements.map(m => ({
        ...m,
        variant_label: variantLabelMap.get(m.variant_id),
        is_online_order: m.reference_type === 'sales_order' && !!m.shopify_order_id,
        is_pos_sale: m.reference_type === 'pos_sale' || m.movement_type.startsWith('pos_'),
      })),
      summary: {
        total_in,
        total_out,
        net: total_in - total_out,
        pos: { in: pos_in, out: pos_out, net: pos_in - pos_out },
        online: { in: online_in, out: online_out, net: online_in - online_out },
      },
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
