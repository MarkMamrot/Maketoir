import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { getCin7Credentials, cin7FetchAllPages } from '@/lib/cin7Helpers';
import { getImportSession, makeSSEStream } from '../_helpers';

const MONTHS_BACK = 36;

function mapStatus(status: string, stage: string): 'draft' | 'approved' | 'received' | 'cancelled' {
  const s = (status ?? '').toUpperCase();
  const g = (stage  ?? '').toLowerCase();
  if (s === 'CANCELLED') return 'cancelled';
  if (g.includes('fully received')) return 'received';
  if (s === 'DRAFT') return 'draft';
  return 'approved';
}

function safeDate(val: any): string | null {
  if (!val) return null;
  const d = String(val).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export async function POST() {
  const session = getImportSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const businessId: string = session.userSpreadsheetId;

  return makeSSEStream(async (send) => {
    send({ status: 'running', message: 'Connecting to Cin7 API...' });

    let creds: Awaited<ReturnType<typeof getCin7Credentials>>;
    try {
      creds = await getCin7Credentials(businessId);
    } catch (e: any) {
      send({ status: 'error', message: `Credentials error: ${e.message}` });
      return;
    }

    // Pre-load lookup maps
    const locations = await imsQuery<{ id: number; cin7_branch_id: number }>(
      'SELECT id, cin7_branch_id FROM ims_locations WHERE cin7_branch_id IS NOT NULL',
    );
    const locMap = new Map(locations.map(l => [l.cin7_branch_id, l.id]));

    const suppliers = await imsQuery<{ id: number; cin7_supplier_id: number }>(
      'SELECT id, cin7_supplier_id FROM ims_contacts WHERE cin7_supplier_id IS NOT NULL',
    );
    const supplierMap = new Map(suppliers.map(s => [s.cin7_supplier_id, s.id]));

    const variants = await imsQuery<{ variant_id: string; cin7_option_id: number }>(
      'SELECT variant_id, cin7_option_id FROM ims_product_variants WHERE cin7_option_id IS NOT NULL',
    );
    const variantMap = new Map(variants.map(v => [v.cin7_option_id, v.variant_id]));

    // Existing PO cin7_order_ids
    const existingPOs = await imsQuery<{ id: number; cin7_order_id: string }>(
      'SELECT id, cin7_order_id FROM ims_purchase_orders WHERE cin7_order_id IS NOT NULL',
    );
    const poMap = new Map(existingPOs.map(p => [p.cin7_order_id, p.id]));

    // Cutoff date — last N months
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK);
    const cutoffStr = cutoff.toISOString().replace(/\.\d{3}Z$/, 'Z'); // yyyy-MM-ddTHH:mm:ssZ

    send({ status: 'running', message: `Fetching purchase orders from Cin7 since ${cutoffStr.slice(0, 10)}...` });

    let orders: any[];
    try {
      orders = await cin7FetchAllPages(
        creds.authHeader,
        '/PurchaseOrders',
        { where: `createdDate>='${cutoffStr}'` },
        'ims/po',
      );
      send({ status: 'running', message: `Fetched ${orders.length} purchase orders. Importing...` });
    } catch (e: any) {
      send({ status: 'error', message: `Cin7 API error: ${e.message}` });
      return;
    }

    let added = 0; let skipped = 0; let missingLoc = 0;

    for (const order of orders) {
      const cin7Id = String(order.id);

      // Compute totals from Cin7 order data (works for both new and existing POs)
      const lines: any[] = Array.isArray(order.lineItems) ? order.lineItems : [];
      const subtotal    = lines.reduce((s, l) => {
        const qty = Number(l.qty ?? 0);
        const unitPrice = Number(l.unitPrice ?? 0);
        return s + Number(l.total ?? l.lineTotal ?? qty * unitPrice);
      }, 0);
      const taxAmount   = Number(order.taxTotal ?? order.taxAmount ?? 0);
      const freight     = Number(order.freightTotal ?? order.freight ?? 0);
      const discount    = Number(order.discountTotal ?? order.discount ?? 0);
      const totalAmount = Number(order.total ?? order.totalIncTax ?? subtotal + taxAmount + freight - discount);

      // If already imported, update totals + is_historical and skip line items
      if (poMap.has(cin7Id)) {
        await imsExecute(
          `UPDATE ims_purchase_orders
             SET is_historical=1, subtotal=?, tax_amount=?, freight=?, discount=?, total_amount=?
           WHERE id=?`,
          [subtotal, taxAmount, freight, discount, totalAmount, poMap.get(cin7Id)],
        );
        skipped++;
        continue;
      }

      const locationId = locMap.get(Number(order.branchId)) ?? null;
      if (locationId === null) { missingLoc++; continue; }

      const supplierId  = supplierMap.get(Number(order.memberId)) ?? null;
      const status      = mapStatus(order.status ?? '', order.stage ?? '');
      const poNumber    = order.reference || `PO-CIN7-${cin7Id}`;
      const orderDate   = safeDate(order.invoiceDate ?? order.createdDate) ?? new Date().toISOString().slice(0, 10);
      const expectedDate  = safeDate(order.expectedDeliveryDate);
      const receivedDate  = safeDate(order.fullyReceivedDate);
      const isHistorical = 1; // all Cin7 POs are read-only

      const res = await imsExecute(
        `INSERT INTO ims_purchase_orders
           (po_number, supplier_id, location_id, status, order_date, expected_date, received_date,
            subtotal, tax_amount, freight, discount, total_amount, cin7_order_id, is_historical)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [poNumber, supplierId, locationId, status, orderDate, expectedDate, receivedDate,
         subtotal, taxAmount, freight, discount, totalAmount, cin7Id, isHistorical],
      ) as any;

      const poId = res.insertId;
      poMap.set(cin7Id, poId);

      for (const line of lines) {
        const variantId = variantMap.get(Number(line.productOptionId)) ?? null;
        if (!variantId) continue;

        const qty        = Number(line.qty ?? 0);
        const unitCost   = Number(line.unitPrice ?? 0);
        const lineTotal  = Number(line.total ?? line.lineTotal ?? qty * unitCost);
        const qtyReceived = status === 'received' ? qty : 0;

        await imsExecute(
          `INSERT INTO ims_purchase_order_items
             (po_id, variant_id, qty_ordered, qty_received, unit_cost, tax_rate, line_total)
           VALUES (?, ?, ?, ?, ?, 0, ?)`,
          [poId, variantId, qty, qtyReceived, unitCost, lineTotal],
        );
      }

      added++;
    }

    const missingNote = missingLoc > 0 ? ` (${missingLoc} skipped — location not found, run Locations import first)` : '';
    send({
      status: 'done', added, skipped,
      message: `Done — ${added} added, ${skipped} already existed.${missingNote}`,
    });
  });
}
