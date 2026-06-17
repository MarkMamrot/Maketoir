import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getIMSPool, imsQuery, imsExecute } from '@/services/IMSMySQLService';

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
  if (!getSession()) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      po_id,
      location_id,
      received_items = [],
      product_updates = [],
      stock_updates = [],
      mark_po_received = false, // optional: mark PO as received
    } = body as {
      po_id: number;
      location_id: number;
      received_items: ReceivedItem[];
      product_updates: ProductUpdate[];
      stock_updates: StockUpdate[];
      mark_po_received?: boolean;
    };

    if (!po_id || !location_id) {
      return NextResponse.json(
        { error: 'po_id and location_id are required' },
        { status: 400 }
      );
    }

    const pool = getIMSPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      let productUpdatesCount = 0;
      let stockUpdatesCount = 0;
      let variantUpdatesCount = 0;

      // ─── 1. Update qty_received for PO items ───────────────────────
      for (const item of received_items) {
        const { variant_id, qty_received, barcode_new } = item;

        // Update qty_received on PO item
        await conn.execute(
          `UPDATE ims_purchase_order_items
           SET qty_received = ?
           WHERE po_id = ? AND variant_id = ?`,
          [qty_received, po_id, variant_id]
        );

        // Get current stock before update
        const [[currentStock]] = await conn.execute<any[]>(
          `SELECT qty_on_hand, avg_cost FROM ims_stock WHERE variant_id = ? AND location_id = ?`,
          [variant_id, location_id]
        );

        const oldQty = currentStock?.qty_on_hand ?? 0;
        const oldAvgCost = currentStock?.avg_cost ?? 0;
        const newQty = oldQty + qty_received;

        // Update ims_stock with new qty_on_hand
        await conn.execute(
          `INSERT INTO ims_stock (variant_id, location_id, qty_on_hand)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand + VALUES(qty_on_hand)`,
          [variant_id, location_id, qty_received]
        );

        // Create stock movement record
        await conn.execute(
          `INSERT INTO ims_stock_movements
           (variant_id, location_id, movement_type, reference_type, reference_id, qty_change, qty_after_soh, unit_cost)
           VALUES (?, ?, 'po_received', 'purchase_order', ?, ?, ?, ?)`,
          [variant_id, location_id, po_id, qty_received, newQty, oldAvgCost]
        );

        // ─── Update barcode if provided ─────────────────────────────
        if (barcode_new) {
          await conn.execute(
            `UPDATE ims_product_variants SET barcode = ? WHERE variant_id = ?`,
            [barcode_new, variant_id]
          );
          variantUpdatesCount++;
        }
      }

      // ─── 2. Update product-level metadata (zone, bin) ─────────────
      for (const update of product_updates) {
        const { product_id, zone, bin } = update;

        if (zone || bin) {
          const updates: string[] = [];
          const params: any[] = [];

          if (zone) {
            updates.push('zone = ?');
            params.push(zone);
          }
          if (bin) {
            updates.push('bin = ?');
            params.push(bin);
          }

          params.push(product_id);

          await conn.execute(
            `UPDATE ims_products SET ${updates.join(', ')} WHERE product_id = ?`,
            params
          );

          productUpdatesCount++;
        }
      }

      // ─── 3. Update stock-level metadata (min_qty, reorder_qty) ────
      for (const update of stock_updates) {
        const { variant_id, min_qty, reorder_qty } = update;

        if (min_qty !== undefined || reorder_qty !== undefined) {
          const updates: string[] = [];
          const params: any[] = [];

          if (min_qty !== undefined) {
            updates.push('min_qty = ?');
            params.push(min_qty);
          }
          if (reorder_qty !== undefined) {
            updates.push('reorder_qty = ?');
            params.push(reorder_qty);
          }

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

      // ─── 4. Optionally mark PO as received ─────────────────────────
      if (mark_po_received) {
        await conn.execute(
          `UPDATE ims_purchase_orders SET status = 'received', received_date = CURDATE() WHERE id = ?`,
          [po_id]
        );
      }

      await conn.commit();

      return NextResponse.json({
        success: true,
        po_id,
        items_received: received_items.length,
        product_updates: productUpdatesCount,
        stock_updates: stockUpdatesCount,
        variant_updates: variantUpdatesCount,
        message: `Received ${received_items.length} items for PO #${po_id}`,
      });
    } finally {
      conn.release();
    }
  } catch (e: any) {
    console.error('Batch receive error:', e);
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}
