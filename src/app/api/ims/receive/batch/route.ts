import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIMSPool, imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { triggerPOXeroSync } from '@/lib/ims/xeroHooks';
import { ImsPORepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { enterImsForBusiness } from '@/lib/db/BusinessRegistry';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try {
    return JSON.parse(c.value);
  } catch {
    return null;
  }
}

interface ReceivedItem {
  variant_id: string;
  qty_received: number;
  barcode_new?: string;
}

interface ProductUpdate {
  product_id: string;
  zone?: string;
  bin?: string;
}

interface StockUpdate {
  variant_id: string;
  min_qty?: number;
  reorder_qty?: number;
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const businessId = session.businessId as string;

  try {
    await enterImsForBusiness(businessId);
    const body = await req.json();
    const {
      po_id,
      location_id,
      received_items = [],
      product_updates = [],
      stock_updates = [],
      mark_po_received = false,
      create_backorder_po = false,
    } = body as {
      po_id: number;
      location_id: number;
      received_items: ReceivedItem[];
      product_updates: ProductUpdate[];
      stock_updates: StockUpdate[];
      mark_po_received?: boolean;
      create_backorder_po?: boolean;
    };

    if (!po_id || !location_id) {
      return NextResponse.json({ error: 'po_id and location_id are required' }, { status: 400 });
    }

    const pool = getIMSPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // Guard: never receive stock into an already-completed PO (prevents the
      // double-count that happens if the receive is submitted/retried twice).
      const [[poRow]] = await conn.execute<any[]>(
        `SELECT status, is_historical FROM ims_purchase_orders WHERE id = ? FOR UPDATE`,
        [po_id]
      );
      if (!poRow) {
        await conn.rollback();
        return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
      }
      if (poRow.is_historical) {
        await conn.rollback();
        return NextResponse.json({ error: 'Cannot receive a historical Cin7 record' }, { status: 409 });
      }
      if (poRow.status === 'complete') {
        await conn.rollback();
        return NextResponse.json({ error: 'This purchase order is already fully received.' }, { status: 409 });
      }

      let productUpdatesCount = 0;
      let stockUpdatesCount = 0;
      let variantUpdatesCount = 0;

      // ─── 1. Update qty_received (accumulate) + stock ──────────────────────
      for (const item of received_items) {
        const { variant_id, qty_received, barcode_new } = item;

        // Accumulate qty_received (not overwrite) for multiple partial receive sessions
        await conn.execute(
          `UPDATE ims_purchase_order_items
           SET qty_received = qty_received + ?
           WHERE po_id = ? AND variant_id = ?`,
          [qty_received, po_id, variant_id]
        );

        const [[currentStock]] = await conn.execute<any[]>(
          `SELECT qty_on_hand, avg_cost FROM ims_stock WHERE variant_id = ? AND location_id = ?`,
          [variant_id, location_id]
        );

        const oldQty = currentStock?.qty_on_hand ?? 0;
        const newQty = oldQty + qty_received;

        // Increment qty_on_hand (set business_id so newly-created rows are
        // visible in the business-scoped Stock Levels view)
        await conn.execute(
          `INSERT INTO ims_stock (variant_id, location_id, business_id, qty_on_hand)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand + VALUES(qty_on_hand)`,
          [variant_id, location_id, businessId, qty_received]
        );

        // Decrement qty_incoming by the amount now received
        await conn.execute(
          `UPDATE ims_stock
           SET qty_incoming = GREATEST(0, qty_incoming - ?)
           WHERE variant_id = ? AND location_id = ?`,
          [qty_received, variant_id, location_id]
        );

        // Stock movement record
        const oldAvgCost = currentStock?.avg_cost ?? 0;
        await conn.execute(
          `INSERT INTO ims_stock_movements
           (variant_id, location_id, movement_type, channel, reference_type, reference_id, qty_change, qty_after_soh, unit_cost)
           VALUES (?, ?, 'po_received', NULL, 'purchase_order', ?, ?, ?, ?)`,
          [variant_id, location_id, po_id, qty_received, newQty, oldAvgCost]
        );

        if (barcode_new) {
          await conn.execute(
            `UPDATE ims_product_variants SET barcode = ? WHERE variant_id = ?`,
            [barcode_new, variant_id]
          );
          variantUpdatesCount++;
        }
      }

      // ─── 2. Product metadata (zone, bin) ─────────────────────────────────
      for (const update of product_updates) {
        const { product_id, zone, bin } = update;
        if (zone || bin) {
          const updates: string[] = [];
          const params: any[] = [];
          if (zone) { updates.push('zone = ?'); params.push(zone); }
          if (bin)  { updates.push('bin = ?');  params.push(bin);  }
          params.push(product_id);
          await conn.execute(
            `UPDATE ims_products SET ${updates.join(', ')} WHERE product_id = ?`, params
          );
          productUpdatesCount++;
        }
      }

      // ─── 3. Stock metadata (min_qty, reorder_qty) ────────────────────────
      for (const update of stock_updates) {
        const { variant_id, min_qty, reorder_qty } = update;
        if (min_qty !== undefined || reorder_qty !== undefined) {
          const updates: string[] = [];
          const params: any[] = [];
          if (min_qty !== undefined)    { updates.push('min_qty = ?');    params.push(min_qty);    }
          if (reorder_qty !== undefined) { updates.push('reorder_qty = ?'); params.push(reorder_qty); }
          params.push(variant_id);
          params.push(location_id);
          await conn.execute(
            `INSERT INTO ims_stock (variant_id, location_id) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE ${updates.join(', ')}`,
            [variant_id, location_id, ...params.slice(0, -2), ...params.slice(-2)]
          );
          stockUpdatesCount++;
        }
      }

      // ─── 4. Determine final PO status ────────────────────────────────────
      // Re-read current qty_received for all items to check for shortfall
      const allItems = await conn.execute<any[]>(
        `SELECT variant_id, qty_ordered, qty_received
         FROM ims_purchase_order_items WHERE po_id = ?`,
        [po_id]
      );
      const poItems: any[] = (allItems[0] as any[]) ?? [];

      const shortfallItems = poItems.filter(
        (i: any) => Number(i.qty_received) < Number(i.qty_ordered)
      ).map((i: any) => ({
        variant_id: i.variant_id,
        product_name: i.product_name,
        sku: i.sku,
        qty_ordered: Number(i.qty_ordered),
        qty_received: Number(i.qty_received),
        shortfall: Number(i.qty_ordered) - Number(i.qty_received),
      }));

      const allReceived = shortfallItems.length === 0;
      const newStatus = (mark_po_received || allReceived) ? 'complete' : 'partially_received';

      if (newStatus === 'complete') {
        await conn.execute(
          `UPDATE ims_purchase_orders SET status = 'complete', received_date = CURDATE() WHERE id = ?`,
          [po_id]
        );
      } else {
        await conn.execute(
          `UPDATE ims_purchase_orders SET status = 'partially_received' WHERE id = ?`,
          [po_id]
        );
      }

      // ─── 5. Backorder PO creation ─────────────────────────────────────────
      let backorderPoId: number | null = null;
      let backorderPoNumber: string | null = null;

      if (create_backorder_po && shortfallItems.length > 0) {
        // Fetch original PO for header details
        const [[origPo]] = await conn.execute<any[]>(
          `SELECT * FROM ims_purchase_orders WHERE id = ?`, [po_id]
        );
        if (origPo) {
          // Generate backorder PO number: {orig}-B, falling back to -B2, -B3 etc.
          let suffix = 'B';
          let attempt = 1;
          let candidateNumber = `${origPo.po_number}-${suffix}`;
          while (true) {
            const [[existing]] = await conn.execute<any[]>(
              `SELECT id FROM ims_purchase_orders WHERE po_number = ? LIMIT 1`,
              [candidateNumber]
            );
            if (!existing) break;
            attempt++;
            candidateNumber = `${origPo.po_number}-B${attempt}`;
          }
          backorderPoNumber = candidateNumber;

          // Fetch original items to get unit_cost etc.
          const [origItemRows] = await conn.execute<any[]>(
            `SELECT * FROM ims_purchase_order_items WHERE po_id = ?`, [po_id]
          );
          const origItems: any[] = (origItemRows as any[]) ?? [];

          // Create the backorder PO
          const bkResult = await conn.execute<any>(
            `INSERT INTO ims_purchase_orders
               (business_id, po_number, supplier_id, location_id, status, order_date,
                expected_date, notes, supplier_invoice_number, payment_terms,
                tax_treatment, tax_code, currency_code, exchange_rate,
                freight, discount, subtotal, tax_amount, total_amount)
             VALUES (?,?,?,?,'draft',CURDATE(),?,?,?,?,?,?,?,?,0,0,0,0,0)`,
            [
              businessId,
              backorderPoNumber,
              origPo.supplier_id ?? null,
              origPo.location_id,
              origPo.expected_date ?? null,
              `Backorder from ${origPo.po_number}`,
              origPo.supplier_invoice_number ? `${origPo.supplier_invoice_number}-B` : null,
              origPo.payment_terms ?? null,
              origPo.tax_treatment ?? 'ex_tax',
              origPo.tax_code ?? null,
              origPo.currency_code ?? 'AUD',
              origPo.exchange_rate ?? 1,
            ]
          );
          backorderPoId = (bkResult[0] as any).insertId;

          // Insert shortfall items into the backorder PO
          let bkSubtotal = 0;
          let bkTax = 0;
          for (const sf of shortfallItems) {
            const origItem = origItems.find((i: any) => i.variant_id === sf.variant_id);
            if (!origItem) continue;
            const lineTotal = sf.shortfall * Number(origItem.unit_cost) * (1 - Number(origItem.discount_pct ?? 0) / 100);
            const lineTax = lineTotal * Number(origItem.tax_rate ?? 0);
            bkSubtotal += lineTotal;
            bkTax += lineTax;
            await conn.execute(
              `INSERT INTO ims_purchase_order_items
                 (po_id, variant_id, qty_ordered, qty_received, unit_cost, discount_pct, tax_rate, line_total, notes)
               VALUES (?,?,?,0,?,?,?,?,?)`,
              [
                backorderPoId,
                sf.variant_id,
                sf.shortfall,
                origItem.unit_cost,
                origItem.discount_pct ?? 0,
                origItem.tax_rate ?? 0,
                lineTotal,
                origItem.notes ?? null,
              ]
            );
          }
          // Update backorder PO totals
          await conn.execute(
            `UPDATE ims_purchase_orders
             SET subtotal = ?, tax_amount = ?, total_amount = ?
             WHERE id = ?`,
            [bkSubtotal, bkTax, bkSubtotal + bkTax, backorderPoId]
          );
        }
      }

      await conn.commit();

      // ─── 6. Post-commit side effects ──────────────────────────────────────
      // Refresh variant cache for received items
      const receivedVariantIds = received_items.map(i => i.variant_id).filter(Boolean);
      if (receivedVariantIds.length > 0) {
        refreshVariantCache(receivedVariantIds).catch(() => {});
      }

      // Trigger Xero approve-bill when PO is fully received (awaited to ensure bill is approved before response)
      if (newStatus === 'complete') {
        await triggerPOXeroSync(businessId, po_id, 'complete').catch(err => console.error('[Xero] PO bill approve failed:', err));
      }

      return NextResponse.json({
        success: true,
        po_id,
        newStatus,
        allReceived,
        shortfallItems,
        items_received: received_items.length,
        product_updates: productUpdatesCount,
        stock_updates: stockUpdatesCount,
        variant_updates: variantUpdatesCount,
        backorderPoId,
        backorderPoNumber,
        message: newStatus === 'complete'
          ? `PO received. ${shortfallItems.length > 0 ? `${shortfallItems.length} items were short.` : 'All items fully received.'}`
          : `Progress saved — ${shortfallItems.length} items still outstanding.`,
      });
    } finally {
      conn.release();
    }
  } catch (e: any) {
    console.error('Batch receive error:', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

