import { NextRequest, NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';


// GET /api/ims/online-sales/day?date=YYYY-MM-DD&location_id=X
// Returns all sales orders (with items) for a given day.
export async function GET(req: NextRequest) {
  if (!await getImsSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const locationId = searchParams.get('location_id');

  if (!date) return NextResponse.json({ success: false, error: 'date is required' }, { status: 400 });

  const params: any[] = [date];
  const locWhere = locationId ? 'AND so.location_id = ?' : '';
  if (locationId) params.push(Number(locationId));

  try {
    const orders = await imsQuery<any>(
      `SELECT so.*,
              c.name AS customer_name,
              l.name AS location_name
       FROM ims_sales_orders so
       LEFT JOIN ims_contacts c ON c.id = so.customer_id
       LEFT JOIN ims_locations l ON l.id = so.location_id
       WHERE so.so_type = 'online' AND DATE_FORMAT(so.order_date, '%Y-%m-%d') = ?
       ${locWhere}
       ORDER BY so.order_date ASC, so.id ASC`,
      params,
    );

    if (!orders.length) return NextResponse.json({ success: true, orders: [] });

    const orderIds = orders.map((o: any) => o.id);
    const items = await imsQuery<any>(
      `SELECT i.*,
              COALESCE(p.name, i.name) AS product_name,
              p.product_id AS product_id,
              v.sku
       FROM ims_sales_order_items i
       LEFT JOIN ims_product_variants v ON v.variant_id = i.variant_id
       LEFT JOIN ims_products p ON p.product_id = v.product_id
       WHERE i.so_id IN (${orderIds.map(() => '?').join(',')})
       ORDER BY i.id`,
      orderIds,
    );

    const itemsByOrder = new Map<number, any[]>();
    for (const item of items) {
      if (!itemsByOrder.has(item.so_id)) itemsByOrder.set(item.so_id, []);
      itemsByOrder.get(item.so_id)!.push(item);
    }

    // ── Resolve pick location per line item ──────────────────────────────────
    const session = await getImsSession();
    const businessId = session?.businessId as string | undefined;

    // Priority-ordered pick location list (from settings), fall back to has_online locations
    let priority: number[] = [];
    try {
      const rows = await imsQuery<{ value: string }>(
        `SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = 'online_pick_priority' LIMIT 1`,
        [businessId ?? ''],
      );
      if (rows[0]?.value) { const arr = JSON.parse(rows[0].value); if (Array.isArray(arr)) priority = arr.map(Number).filter(Boolean); }
    } catch {}
    if (priority.length === 0) {
      try {
        const locs = await imsQuery<{ id: number }>(
          `SELECT id FROM ims_locations WHERE has_online = 1 ${businessId ? 'AND business_id = ?' : ''} ORDER BY name`,
          businessId ? [businessId] : [],
        );
        priority = locs.map(l => l.id);
      } catch {}
    }

    // Build variant → location → available + on-hand map for priority locations
    const allVariantIds = [...new Set(items.map((i: any) => i.variant_id).filter(Boolean))];
    const availByVarLoc = new Map<string, Map<number, number>>();  // net available (on_hand - committed)
    const sohByVarLoc   = new Map<string, Map<number, number>>();  // gross qty_on_hand
    const locNameById = new Map<number, string>();
    if (allVariantIds.length > 0 && priority.length > 0) {
      const vPh = allVariantIds.map(() => '?').join(',');
      const lPh = priority.map(() => '?').join(',');
      const stockRows = await imsQuery<{ variant_id: string; location_id: number; qty_on_hand: number; available: number; location_name: string }>(
        `SELECT s.variant_id, s.location_id,
                s.qty_on_hand,
                (s.qty_on_hand - COALESCE(s.qty_committed,0)) AS available,
                l.name AS location_name
         FROM ims_stock s JOIN ims_locations l ON l.id = s.location_id
         WHERE s.variant_id IN (${vPh}) AND s.location_id IN (${lPh})`,
        [...allVariantIds, ...priority],
      );
      for (const r of stockRows) {
        if (!availByVarLoc.has(r.variant_id)) availByVarLoc.set(r.variant_id, new Map());
        if (!sohByVarLoc.has(r.variant_id))   sohByVarLoc.set(r.variant_id, new Map());
        availByVarLoc.get(r.variant_id)!.set(r.location_id, Number(r.available));
        sohByVarLoc.get(r.variant_id)!.set(r.location_id, Number(r.qty_on_hand));
        locNameById.set(r.location_id, r.location_name);
      }
    }
    // Ensure names for priority locations even with no stock rows
    if (priority.length > 0 && priority.some(id => !locNameById.has(id))) {
      try {
        const lPh = priority.map(() => '?').join(',');
        const names = await imsQuery<{ id: number; name: string }>(
          `SELECT id, name FROM ims_locations WHERE id IN (${lPh})`, priority,
        );
        for (const n of names) locNameById.set(n.id, n.name);
      } catch {}
    }

    const resolvePick = (variantId: string, qtyOrdered: number) => {
      const byAvail = availByVarLoc.get(variantId);
      const bySoh   = sohByVarLoc.get(variantId);

      // ── Pass 1: first priority location with enough physical stock (qty_on_hand) ──
      // Use qty_on_hand rather than net-available so that stock that is already
      // committed to THIS order isn't wrongly treated as unavailable.
      for (const locId of priority) {
        const soh   = bySoh?.get(locId) ?? 0;
        const avail = byAvail?.get(locId) ?? 0;
        if (soh >= qtyOrdered && qtyOrdered > 0) {
          // Physical stock is sufficient; flag as needing transfer only when the
          // net-available figure is short (e.g. due to buffer / other commitments).
          const needs_transfer = avail < qtyOrdered;
          return {
            pick_location_id:   locId,
            pick_location_name: locNameById.get(locId) ?? '',
            warehouse_available: avail,
            missing: false,
            needs_transfer,
          };
        }
      }

      // ── Pass 2: first priority location with any physical stock (partial fill) ──
      for (const locId of priority) {
        const soh = bySoh?.get(locId) ?? 0;
        if (soh > 0) {
          return {
            pick_location_id:   locId,
            pick_location_name: locNameById.get(locId) ?? '',
            warehouse_available: byAvail?.get(locId) ?? 0,
            missing: true,
            needs_transfer: true,
          };
        }
      }

      // ── Pass 3: no stock anywhere — fall back to first priority location ──
      const fallbackId    = priority[0];
      const fallbackAvail = fallbackId ? (byAvail?.get(fallbackId) ?? 0) : 0;
      return {
        pick_location_id:   fallbackId ?? null,
        pick_location_name: fallbackId ? (locNameById.get(fallbackId) ?? '') : '',
        warehouse_available: fallbackAvail,
        missing: true,
        needs_transfer: false,
      };
    };

    const result = orders.map((o: any) => {
      const its = (itemsByOrder.get(o.id) ?? []).map((it: any) => {
        const pick = resolvePick(it.variant_id, Number(it.qty_ordered ?? 0));
        return { ...it, ...pick };
      });
      const has_missing  = its.some((it: any) => it.missing);
      const has_transfer = its.some((it: any) => it.needs_transfer && !it.missing);
      return { ...o, items: its, has_missing, has_transfer };
    });

    // Shop domain for building Shopify admin order links (returns are initiated there).
    let shopDomain: string | null = null;
    try {
      const conn = await query<{ shopify_shop_id: string | null }>(
        `SELECT shopify_shop_id FROM connections WHERE business_id = ? LIMIT 1`,
        [businessId ?? ''],
      );
      const raw = conn[0]?.shopify_shop_id;
      if (raw) shopDomain = String(raw).replace(/\.myshopify\.com$/, '') + '.myshopify.com';
    } catch {}

    return NextResponse.json({ success: true, orders: result, shopDomain });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
