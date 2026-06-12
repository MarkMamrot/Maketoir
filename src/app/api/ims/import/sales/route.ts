import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { getImportSession, getLegacyConn, makeSSEStream } from '../_helpers';

/**
 * Parses the POS reference timestamp.
 * e.g. "QV-20250603-101723"  →  "2025-06-03 10:17:23"
 *      "Newtown-20250603-122802"  →  "2025-06-03 12:28:02"
 */
function parsePOSTimestamp(reference: string | null): string | null {
  if (!reference) return null;
  const m = reference.match(/(\d{8})-(\d{6})$/);
  if (!m) return null;
  const d = m[1]; const t = m[2];
  return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)} ${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`;
}

export async function POST() {
  const session = getImportSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const businessId: string = session.userSpreadsheetId;

  return makeSSEStream(async (send) => {
    send({ status: 'running', message: 'Reading sales from database...' });

    const conn = await getLegacyConn(businessId);
    try {
      const [salesRows] = await conn.execute<any[]>(
        `SELECT id, order_id, reference, invoice_date, branch_id, product_option_id,
                code, name, qty, unit_price, line_total, source, status
         FROM sales WHERE business_id = ? ORDER BY order_id, id`,
        [businessId],
      );
      send({ status: 'running', message: `Found ${salesRows.length} sale lines. Splitting channels...` });

      // Pre-load location lookup: cin7_branch_id → ims_locations.id
      const locations = await imsQuery<{ id: number; cin7_branch_id: number | null }>(
        'SELECT id, cin7_branch_id FROM ims_locations WHERE cin7_branch_id IS NOT NULL',
      );
      const locMap = new Map(locations.map(l => [l.cin7_branch_id!, l.id]));

      // Pre-load variant lookup: cin7_option_id → variant_id
      const variants = await imsQuery<{ variant_id: string; cin7_option_id: number | null }>(
        'SELECT variant_id, cin7_option_id FROM ims_product_variants WHERE cin7_option_id IS NOT NULL',
      );
      const variantMap = new Map(variants.map(v => [v.cin7_option_id!, v.variant_id]));

      // Pre-load existing SO cin7_order_ids
      const existingSOs = await imsQuery<{ id: number; cin7_order_id: string | null }>(
        'SELECT id, cin7_order_id FROM ims_sales_orders WHERE cin7_order_id IS NOT NULL',
      );
      const soMap = new Map(existingSOs.map(s => [s.cin7_order_id!, s.id]));

      // Pre-load existing POS local_ids
      const existingPOS = await imsQuery<{ id: number; local_id: string }>(
        'SELECT id, local_id FROM pos_sales WHERE local_id IS NOT NULL',
      );
      const posMap = new Map(existingPOS.map(s => [s.local_id, s.id]));

      // Group lines by order_id
      const byOrder = new Map<string, typeof salesRows>();
      for (const r of salesRows) {
        if (!byOrder.has(r.order_id)) byOrder.set(r.order_id, []);
        byOrder.get(r.order_id)!.push(r);
      }

      let posAdded = 0; let posSkipped = 0;
      let soAdded = 0;  let soSkipped = 0;

      send({ status: 'running', message: `Processing ${byOrder.size} orders...` });

      let missingLocation = 0;
      for (const [orderId, lines] of byOrder) {
        const first = lines[0];
        const isPOS = first.source?.startsWith('POS-');
        const locationId = locMap.get(parseInt(first.branch_id)) ?? null;

        if (locationId === null) {
          missingLocation++;
          continue; // skip — locations not imported yet
        }

        if (isPOS) {
          // ── POS sale ──────────────────────────────────────────────────────
          if (posMap.has(orderId)) { posSkipped++; continue; }

          const total    = lines.reduce((s, l) => s + Number(l.line_total), 0);
          const completedAt = parsePOSTimestamp(first.reference);

          const res = await imsExecute(
            `INSERT INTO pos_sales
               (local_id, location_id, sale_type, status, subtotal, discount_total, tax_total, total, created_at, completed_at, is_historical)
             VALUES (?, ?, 'sale', 'completed', ?, 0, 0, ?, ?, ?, 1)`,
            [orderId, locationId, total, total,
             first.invoice_date, completedAt ?? first.invoice_date],
          ) as any;
          const saleId = res.insertId;
          posMap.set(orderId, saleId);

          for (const l of lines) {
            const variantId = variantMap.get(parseInt(l.product_option_id)) ?? null;
            await imsExecute(
              `INSERT INTO pos_sale_items
                 (sale_id, variant_id, code, name, qty, unit_price, original_price,
                  discount_type, discount_value, discount_amount, tax_rate, line_total)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'none', 0, 0, 0, ?)`,
              [saleId, variantId, l.code || null, l.name || null,
               l.qty, l.unit_price, l.unit_price, l.line_total],
            );
          }
          posAdded++;

        } else {
          // ── Sales Order (Shopify / B2B / Backend) ─────────────────────────
          if (soMap.has(orderId)) { soSkipped++; continue; }

          const subtotal = lines.reduce((s, l) => s + Number(l.line_total), 0);
          const soRef = first.reference || orderId;
          const shopifyOrderId = first.source?.startsWith('Shopify') ? orderId : null;

          const res = await imsExecute(
            `INSERT INTO ims_sales_orders
               (so_number, location_id, status, order_date, fulfilled_date, subtotal, tax_amount, total_amount,
                shopify_order_id, cin7_order_id, is_historical)
             VALUES (?, ?, 'fulfilled', ?, ?, ?, 0, ?, ?, ?, 1)`,
            [soRef, locationId, first.invoice_date, first.invoice_date,
             subtotal, subtotal, shopifyOrderId, orderId],
          ) as any;
          const soId = res.insertId;
          soMap.set(orderId, soId);

          for (const l of lines) {
            const variantId = variantMap.get(parseInt(l.product_option_id)) ?? null;
            await imsExecute(
              `INSERT INTO ims_sales_order_items
                 (so_id, variant_id, code, name, qty_ordered, qty_fulfilled, unit_price, discount_pct, tax_rate, line_total)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
              [soId, variantId, l.code || null, l.name || null,
               l.qty, l.qty, l.unit_price, l.line_total],
            );
          }
          soAdded++;
        }
      }

      const missingNote = missingLocation > 0 ? ` (${missingLocation} orders skipped — run Locations import first)` : '';
      send({
        status: missingLocation > 0 ? 'error' : 'done',
        posAdded, posSkipped, soAdded, soSkipped,
        message: `Done — POS: ${posAdded} added, ${posSkipped} skipped. Sales Orders: ${soAdded} added, ${soSkipped} skipped.${missingNote}`,
      });
    } finally {
      await conn.end().catch(() => {});
    }
  });
}
