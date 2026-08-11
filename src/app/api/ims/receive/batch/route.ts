import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { getIMSPool } from '@/services/IMSMySQLService';
import { triggerPOXeroSync } from '@/lib/ims/xeroHooks';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getXeroInvoiceStatus } from '@/services/XeroSyncService';
import { createHash, randomUUID } from 'crypto';
import {
  computeLandedCostPerUnit,
  computeReceivedUnitCostAud,
  computeWeightedAverageCost,
  normalizeExchangeRate,
  TaxTreatment,
} from '@/lib/ims/avgCostMath';

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

async function reportReceiveXeroFailure(businessId: string, poId: number, error: unknown, replayed: boolean): Promise<void> {
  console.error(replayed ? '[Xero] PO bill approve replay failed:' : '[Xero] PO bill approve failed:', error);
  await reportRuntimeIssue({
    businessId,
    source: 'ims_purchase_orders',
    operation: 'receive_xero_approval',
    title: 'Purchase order receipt committed but Xero approval failed',
    error,
    context: { replayed },
    reference: { type: 'purchase_order', id: poId },
  });
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const businessId = session.businessId as string;

  try {
    const body = await req.json();
    const {
      po_id,
      location_id,
      received_items = [],
      product_updates = [],
      stock_updates = [],
      mark_po_received = false,
      create_backorder_po = false,
      operation_key,
    } = body as {
      po_id: number;
      location_id: number;
      received_items: ReceivedItem[];
      product_updates: ProductUpdate[];
      stock_updates: StockUpdate[];
      mark_po_received?: boolean;
      create_backorder_po?: boolean;
      operation_key?: string;
    };

    if (!po_id || !location_id) {
      return NextResponse.json({ error: 'po_id and location_id are required' }, { status: 400 });
    }

    const pool = getIMSPool();
    const conn = await pool.getConnection();
    const operationKey = typeof operation_key === 'string' && operation_key.trim() ? operation_key.trim() : randomUUID();
    const requestHash = createHash('sha256').update(JSON.stringify({
      po_id,
      location_id,
      received_items,
      product_updates,
      stock_updates,
      mark_po_received: Boolean(mark_po_received),
      create_backorder_po: Boolean(create_backorder_po),
    })).digest('hex');

    try {
      await conn.beginTransaction();

      await conn.execute(
        `INSERT IGNORE INTO ims_po_receive_operations
          (business_id, operation_key, request_hash, po_id, status, request_json)
         VALUES (?, ?, ?, ?, 'processing', ?)`,
        [businessId, operationKey, requestHash, po_id, JSON.stringify({ received_items, mark_po_received, create_backorder_po })],
      );
      const [[receiveOperation]] = await conn.execute<any[]>(
        `SELECT request_hash, status, response_json
           FROM ims_po_receive_operations
          WHERE business_id = ? AND operation_key = ?
          FOR UPDATE`,
        [businessId, operationKey],
      );
      if (!receiveOperation || String(receiveOperation.request_hash) !== requestHash) {
        await conn.rollback();
        return NextResponse.json({ error: 'This receive operation key was already used with different quantities or options.' }, { status: 409 });
      }
      if (receiveOperation.status === 'complete') {
        const replayedResponse = typeof receiveOperation.response_json === 'string'
          ? JSON.parse(receiveOperation.response_json)
          : receiveOperation.response_json;
        await conn.commit();
        const receivedVariantIds = received_items.map(i => i.variant_id).filter(Boolean);
        if (receivedVariantIds.length > 0) refreshVariantCache(receivedVariantIds).catch(() => {});
        if (replayedResponse?.newStatus === 'complete') {
          await triggerPOXeroSync(businessId, po_id, 'complete').catch(err => reportReceiveXeroFailure(businessId, po_id, err, true));
        }
        return NextResponse.json({ ...replayedResponse, replayed: true });
      }

      // Guard: never receive stock into an already-completed PO (prevents the
      // double-count that happens if the receive is submitted/retried twice).
      const [[poRow]] = await conn.execute<any[]>(
        `SELECT status, is_historical, exchange_rate, tax_treatment, freight, discount, xero_bill_id
         FROM ims_purchase_orders
         WHERE id = ? FOR UPDATE`,
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
      if (poRow.status === 'backordered') {
        await conn.rollback();
        return NextResponse.json({ error: 'Release this supplier backorder before receiving it.' }, { status: 409 });
      }
      if (create_backorder_po && poRow.xero_bill_id) {
        const xeroStatus = await getXeroInvoiceStatus(businessId, String(poRow.xero_bill_id));
        if (xeroStatus !== 'DRAFT') {
          await conn.rollback();
          return NextResponse.json({
            error: `The linked Xero bill is ${xeroStatus ?? 'unavailable'} and cannot be split.`,
          }, { status: 409 });
        }
      }

      let productUpdatesCount = 0;
      let stockUpdatesCount = 0;
      let variantUpdatesCount = 0;

      const settingRows = await conn.execute<any[]>(
        `SELECT \`key\`, value FROM ims_settings
         WHERE business_id = ? AND \`key\` IN ('freight_treatment', 'landed_cost_treatment')`,
        [businessId],
      );
      let includeFreight = false;
      let includeLandedCosts = true;
      for (const row of ((settingRows[0] as any[]) ?? [])) {
        if (row.key === 'freight_treatment') includeFreight = row.value === 'capitalise';
        if (row.key === 'landed_cost_treatment') includeLandedCosts = row.value !== 'expense';
      }

      const [poItemsRows] = await conn.execute<any[]>(
        `SELECT id, variant_id, qty_ordered, qty_received, unit_cost, tax_rate
         FROM ims_purchase_order_items
         WHERE po_id = ?
         FOR UPDATE`,
        [po_id],
      );
      const poLineItems: any[] = (poItemsRows as any[]) ?? [];
      const poItemByVariant = new Map<string, any>();
      for (const row of poLineItems) poItemByVariant.set(String(row.variant_id), row);

      const [landedRows] = await conn.execute<any[]>(
        `SELECT amount FROM ims_po_landed_costs WHERE po_id = ?`,
        [po_id],
      );
      const totalLandedAud = ((landedRows as any[]) ?? []).reduce((sum, r) => sum + Number(r.amount || 0), 0);

      let effectiveRate = normalizeExchangeRate(Number(poRow.exchange_rate ?? 1));
      const [paymentAggRows] = await conn.execute<any[]>(
        `SELECT SUM(amount) AS tot_foreign, SUM(amount_local) AS tot_local
         FROM ims_purchase_order_payments
         WHERE po_id = ?`,
        [po_id],
      );
      const paymentAgg = ((paymentAggRows as any[]) ?? [])[0] ?? {};
      const totForeign = Number(paymentAgg.tot_foreign ?? 0);
      const totLocal = Number(paymentAgg.tot_local ?? 0);
      if (totForeign > 0 && Number.isFinite(totLocal / totForeign)) {
        effectiveRate = totLocal / totForeign;
      }
      if (create_backorder_po && totForeign > 0) {
        await conn.rollback();
        return NextResponse.json({ error: 'Purchase orders with payments cannot be split into backorders.' }, { status: 409 });
      }

      const taxTreatment = (poRow.tax_treatment ?? 'ex_tax') as TaxTreatment;
      const landedPerUnit = computeLandedCostPerUnit(
        poLineItems.map((item) => ({
          key: String(item.id),
          qtyOrdered: Number(item.qty_ordered),
          unitCost: Number(item.unit_cost),
          taxRate: Number(item.tax_rate ?? 0),
        })),
        {
          exchangeRate: effectiveRate,
          taxTreatment,
          totalLandedAud,
          totalFreightAud: Number(poRow.freight ?? 0),
          includeLandedCosts,
          includeFreight,
        },
      );

      // ─── 1. Update qty_received (accumulate) + stock ──────────────────────
      for (const item of received_items) {
        const { variant_id, qty_received, barcode_new } = item;
        const poItem = poItemByVariant.get(String(variant_id));
        if (!poItem) continue;

        const requestedQty = Math.max(0, Number(qty_received || 0));
        const alreadyReceived = Number(poItem.qty_received ?? 0);
        const qtyOrdered = Number(poItem.qty_ordered ?? 0);
        const outstandingQty = Math.max(0, qtyOrdered - alreadyReceived);
        const appliedQty = Math.min(requestedQty, outstandingQty);
        if (appliedQty <= 0) continue;

        // Accumulate qty_received (not overwrite) for multiple partial receive sessions
        await conn.execute(
          `UPDATE ims_purchase_order_items
           SET qty_received = qty_received + ?
           WHERE po_id = ? AND variant_id = ?`,
          [appliedQty, po_id, variant_id]
        );
        poItem.qty_received = alreadyReceived + appliedQty;

        // Read location qty for movement tracking; org-level state for avg calculation
        const [[currentStock]] = await conn.execute<any[]>(
          `SELECT qty_on_hand FROM ims_stock WHERE variant_id = ? AND location_id = ?`,
          [variant_id, location_id]
        );
        const [[orgState]] = await conn.execute<any[]>(
          `SELECT pv.avg_cost AS variant_avg, COALESCE(SUM(s.qty_on_hand), 0) AS total_org_qty
           FROM ims_product_variants pv
           LEFT JOIN ims_stock s ON s.variant_id = pv.variant_id
           WHERE pv.variant_id = ?
           GROUP BY pv.avg_cost`,
          [variant_id]
        );

        const oldQty = currentStock?.qty_on_hand ?? 0;
        const newQty = Number(oldQty) + appliedQty;

        const receivedUnitCostAud = computeReceivedUnitCostAud({
          unitCost: Number(poItem.unit_cost ?? 0),
          taxRate: Number(poItem.tax_rate ?? 0),
          taxTreatment,
          exchangeRate: effectiveRate,
          landedCostPerUnitAud: landedPerUnit.get(String(poItem.id)) ?? 0,
        });
        const oldAvg = Number(orgState?.variant_avg ?? receivedUnitCostAud);
        const oldOrgQty = Number(orgState?.total_org_qty ?? 0);
        const newAvg = computeWeightedAverageCost({
          oldQtyOnHand: oldOrgQty,
          oldAvgCost: oldAvg,
          receivedQty: appliedQty,
          receivedUnitCostAud,
        });

        // Increment qty_on_hand (set business_id so newly-created rows are
        // visible in the business-scoped Stock Levels view)
        await conn.execute(
          `INSERT INTO ims_stock (variant_id, location_id, business_id, qty_on_hand)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             business_id = VALUES(business_id),
             qty_on_hand = qty_on_hand + VALUES(qty_on_hand)`,
          [variant_id, location_id, businessId, appliedQty]
        );

        // Decrement qty_incoming by the amount now received
        await conn.execute(
          `UPDATE ims_stock
           SET qty_incoming = GREATEST(0, qty_incoming - ?)
           WHERE variant_id = ? AND location_id = ?`,
          [appliedQty, variant_id, location_id]
        );

        // Org-wide avg: write to variant + mirror to all location stock rows
        await conn.execute(
          `UPDATE ims_product_variants SET avg_cost = ? WHERE variant_id = ?`,
          [newAvg, variant_id],
        );
        await conn.execute(
          `UPDATE ims_stock SET avg_cost = ? WHERE variant_id = ?`,
          [newAvg, variant_id],
        );

        // Stock movement record
        await conn.execute(
          `INSERT INTO ims_stock_movements
           (variant_id, location_id, movement_type, channel, reference_type, reference_id, qty_change, qty_after_soh, unit_cost)
           VALUES (?, ?, 'po_received', NULL, 'purchase_order', ?, ?, ?, ?)`,
          [variant_id, location_id, po_id, appliedQty, newQty, receivedUnitCostAud]
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
        // Only write fields that are explicitly provided and non-null — never let a
        // missing/null payload field overwrite an existing value.
        const updates: string[] = [];
        const params: any[] = [];
        if (min_qty     !== undefined && min_qty     !== null) { updates.push('min_qty = ?');     params.push(min_qty);     }
        if (reorder_qty !== undefined && reorder_qty !== null) { updates.push('reorder_qty = ?'); params.push(reorder_qty); }
        if (updates.length === 0) continue;
        await conn.execute(
          `INSERT INTO ims_stock (business_id, variant_id, location_id) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE ${updates.join(', ')}`,
          [businessId, variant_id, location_id, ...params],
        );
        stockUpdatesCount++;
      }

      // ─── 4. Determine final PO status ────────────────────────────────────
      // Re-read current qty_received for all items to check for shortfall
      const allItems = await conn.execute<any[]>(
        `SELECT id, variant_id, qty_ordered, qty_received
         FROM ims_purchase_order_items WHERE po_id = ?`,
        [po_id]
      );
      const poItems: any[] = (allItems[0] as any[]) ?? [];

      const shortfallItems = poItems.filter(
        (i: any) => Number(i.qty_received) < Number(i.qty_ordered)
      ).map((i: any) => ({
        id: i.id,
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
             VALUES (?,?,?,?,'backordered',CURDATE(),?,?,NULL,?,?,?,?,?,0,0,0,0,0)`,
            [
              businessId,
              backorderPoNumber,
              origPo.supplier_id ?? null,
              origPo.location_id,
              origPo.expected_date ?? null,
              `Backorder from ${origPo.po_number}`,
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
          const backorderOperationKey = createHash('sha256')
            .update(`${businessId}|po-backorder|${po_id}|${shortfallItems.map((item: any) => `${item.id}:${item.qty_received}`).join('|')}`)
            .digest('hex');
          for (const sf of shortfallItems) {
            const origItem = origItems.find((i: any) => Number(i.id) === Number(sf.id));
            if (!origItem) continue;
            const lineTotal = sf.shortfall * Number(origItem.unit_cost) * (1 - Number(origItem.discount_pct ?? 0) / 100);
            const rate = Number(origItem.tax_rate ?? 0);
            if (origPo.tax_treatment === 'inc_tax' && rate > 0) {
              const exTax = lineTotal / (1 + rate);
              bkSubtotal += exTax;
              bkTax += lineTotal - exTax;
            } else {
              bkSubtotal += lineTotal;
              if (origPo.tax_treatment === 'ex_tax') bkTax += lineTotal * rate;
            }
            const [backorderItemResult] = await conn.execute<any>(
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
            await conn.execute(
              `INSERT INTO ims_po_backorder_lines
                (business_id, operation_key, source_po_id, source_po_item_id, backorder_po_id, backorder_po_item_id, transferred_qty)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [businessId, backorderOperationKey, po_id, origItem.id, backorderPoId, backorderItemResult.insertId, sf.shortfall],
            );
          }
          // Update backorder PO totals
          await conn.execute(
            `UPDATE ims_purchase_orders
             SET subtotal = ?, tax_amount = ?, total_amount = ?
             WHERE id = ?`,
            [bkSubtotal, bkTax, bkSubtotal + bkTax, backorderPoId]
          );

          let actualSubtotal = 0;
          let actualTax = 0;
          for (const origItem of origItems) {
            const currentItem = poItems.find((item: any) => Number(item.id) === Number(origItem.id));
            const actualQty = Number(currentItem?.qty_received ?? 0);
            if (actualQty <= 0) {
              await conn.execute(`DELETE FROM ims_purchase_order_items WHERE id = ?`, [origItem.id]);
              continue;
            }
            const lineTotal = actualQty * Number(origItem.unit_cost) * (1 - Number(origItem.discount_pct ?? 0) / 100);
            const rate = Number(origItem.tax_rate ?? 0);
            if (origPo.tax_treatment === 'inc_tax' && rate > 0) {
              const exTax = lineTotal / (1 + rate);
              actualSubtotal += exTax;
              actualTax += lineTotal - exTax;
            } else {
              actualSubtotal += lineTotal;
              if (origPo.tax_treatment === 'ex_tax') actualTax += lineTotal * rate;
            }
            await conn.execute(
              `UPDATE ims_purchase_order_items SET qty_ordered = ?, line_total = ? WHERE id = ?`,
              [actualQty, lineTotal, origItem.id],
            );
          }
          actualSubtotal = Math.round(actualSubtotal * 100) / 100;
          if (origPo.tax_treatment === 'ex_tax') {
            const freightTaxRate = Number(origItems.find((item: any) => Number(item.tax_rate) > 0)?.tax_rate ?? 0);
            actualTax += Number(origPo.freight ?? 0) * freightTaxRate;
          }
          actualTax = origPo.tax_treatment === 'no_tax' ? 0 : Math.round(actualTax * 100) / 100;
          const actualTotal = Math.round((actualSubtotal + actualTax + Number(origPo.freight ?? 0) - Number(origPo.discount ?? 0)) * 100) / 100;
          await conn.execute(
            `UPDATE ims_purchase_orders SET subtotal = ?, tax_amount = ?, total_amount = ? WHERE id = ?`,
            [actualSubtotal, actualTax, actualTotal, po_id],
          );
        }
      }

      const response = {
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
      };
      await conn.execute(
        `UPDATE ims_po_receive_operations
            SET status = 'complete', response_json = ?, completed_at = NOW()
          WHERE business_id = ? AND operation_key = ?`,
        [JSON.stringify(response), businessId, operationKey],
      );
      await conn.commit();

      // ─── 6. Post-commit side effects ──────────────────────────────────────
      // Refresh variant cache for received items
      const receivedVariantIds = received_items.map(i => i.variant_id).filter(Boolean);
      if (receivedVariantIds.length > 0) {
        refreshVariantCache(receivedVariantIds).catch(() => {});
      }

      // Trigger Xero approve-bill when PO is fully received (awaited to ensure bill is approved before response)
      if (newStatus === 'complete') {
        await triggerPOXeroSync(businessId, po_id, 'complete').catch(err => reportReceiveXeroFailure(businessId, po_id, err, false));
      }

      return NextResponse.json(response);
    } finally {
      conn.release();
    }
  } catch (e: any) {
    console.error('Batch receive error:', e);
    await reportRuntimeIssue({
      businessId,
      source: 'ims_purchase_orders',
      operation: 'receive_purchase_order',
      title: 'Purchase order receive failed',
      error: e,
    });
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

