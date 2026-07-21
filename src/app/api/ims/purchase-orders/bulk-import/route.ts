import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

interface ImportPOItem {
  sku?: string;
  product_name?: string;
  qty: number;
  qty_received?: number;
  unit_cost: number;
  discount_pct?: number;
  tax_rate?: number;
}

interface ImportPORow {
  po_number?: string;
  order_date: string;
  expected_date?: string;
  received_date?: string;
  supplier_name?: string;
  location_name: string;
  status: string;
  tax_treatment?: string;
  currency_code?: string;
  exchange_rate?: number;
  payment_terms?: string;
  supplier_invoice_number?: string;
  notes?: string;
  freight?: number;
  discount?: number;
  items: ImportPOItem[];
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;

  try {
    const body = await req.json();
    const orders: ImportPORow[] = body.orders ?? [];
    if (!orders.length) return NextResponse.json({ success: false, error: 'No orders provided.' }, { status: 400 });

    // Load reference lookups
    const suppliers = await imsQuery<{ id: number; name: string }>(
      `SELECT id, name FROM ims_contacts WHERE business_id = ? AND (type = 'supplier' OR type IS NULL)`,
      [businessId]
    );
    const locs = await imsQuery<{ id: number; name: string }>(
      'SELECT id, name FROM ims_locations WHERE business_id = ?', [businessId]
    );
    const vars = await imsQuery<{ variant_id: string; sku: string | null }>(
      `SELECT pv.variant_id, pv.sku
         FROM ims_product_variants pv
         JOIN ims_products p ON p.product_id = pv.product_id
        WHERE p.business_id = ?`, [businessId]
    );

    const supplierMap = new Map(suppliers.map(s => [s.name.trim().toLowerCase(), s]));
    const locMap      = new Map(locs.map(l => [l.name.trim().toLowerCase(), l.id]));
    const varMap      = new Map(vars.filter(v => v.sku).map(v => [v.sku!.trim().toLowerCase(), v.variant_id]));

    // Check for duplicate PO numbers
    const providedNums = [...new Set(orders.map(o => o.po_number?.trim()).filter(Boolean) as string[])];
    const existingSet  = new Set<string>();
    if (providedNums.length) {
      const ph = providedNums.map(() => '?').join(',');
      const existing = await imsQuery<{ po_number: string }>(
        `SELECT po_number FROM ims_purchase_orders WHERE po_number IN (${ph}) AND business_id = ?`,
        [...providedNums, businessId]
      );
      existing.forEach(r => existingSet.add(r.po_number));
    }

    // Auto-number seed
    const year = new Date().getFullYear();
    const seqRows = await imsQuery<{ max_seq: number | null }>(
      `SELECT MAX(CAST(SUBSTRING_INDEX(po_number, '-', -1) AS UNSIGNED)) AS max_seq
         FROM ims_purchase_orders
        WHERE po_number LIKE ?`,
      [`PO-${year}-%`]
    );
    let seq = (seqRows[0]?.max_seq ?? 0) + 1;

    let created = 0;
    const errors: string[] = [];
    const seenInBatch = new Set<string>();

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      try {
        // Validate required: location
        const locationId = locMap.get((order.location_name ?? '').trim().toLowerCase());
        if (!locationId) {
          errors.push(`PO "${order.po_number ?? `#${i + 1}`}": location "${order.location_name}" not found.`);
          continue;
        }

        // Resolve PO number (auto-assign if blank)
        const poNumber = order.po_number?.trim() || `PO-${year}-${String(seq++).padStart(4, '0')}`;

        if (existingSet.has(poNumber) || seenInBatch.has(poNumber)) {
          errors.push(`PO "${poNumber}": already exists — skipped.`);
          continue;
        }
        seenInBatch.add(poNumber);

        // Resolve supplier by name (optional — store raw name regardless)
        const supplierKey = (order.supplier_name ?? '').trim().toLowerCase();
        const supplierMatch = supplierKey ? supplierMap.get(supplierKey) : undefined;
        const supplierId  = supplierMatch?.id ?? null;
        const supplierRaw = order.supplier_name || null;

        const status = (['draft', 'confirmed', 'partially_received', 'complete', 'cancelled'] as const)
          .includes(order.status as any) ? order.status as string : 'draft';
        const isHistorical = (status === 'complete' || status === 'cancelled') ? 1 : 0;

        const taxTreatment = (['ex_tax', 'inc_tax', 'no_tax'] as const).includes(order.tax_treatment as any)
          ? order.tax_treatment as 'ex_tax' | 'inc_tax' | 'no_tax' : 'ex_tax';
        const currencyCode  = (order.currency_code ?? 'AUD').toUpperCase();
        const exchangeRate  = Number(order.exchange_rate ?? 1) || 1;
        const freight       = Number(order.freight  ?? 0);
        const discount      = Number(order.discount ?? 0);

        // Compute totals from line items
        let subtotal  = 0;
        let taxAmount = 0;
        for (const item of order.items) {
          const qty   = Number(item.qty       || 0);
          const cost  = Number(item.unit_cost || 0);
          const disc  = Number(item.discount_pct ?? 0);
          const rate  = Number(item.tax_rate  ?? 0);
          const line  = qty * cost * (1 - disc / 100);
          if (taxTreatment === 'inc_tax' && rate > 0) {
            const exTax = line / (1 + rate);
            subtotal  += Math.round(exTax          * 100) / 100;
            taxAmount += Math.round((line - exTax) * 100) / 100;
          } else if (taxTreatment === 'ex_tax') {
            subtotal  += line;
            taxAmount += Math.round(line * rate    * 100) / 100;
          } else {
            subtotal  += line;
          }
        }
        subtotal  = Math.round(subtotal  * 100) / 100;
        taxAmount = taxTreatment === 'no_tax' ? 0 : Math.round(taxAmount * 100) / 100;
        const totalAmount = Math.round((subtotal + taxAmount + freight - discount) * 100) / 100;

        const res: any = await imsExecute(
          `INSERT INTO ims_purchase_orders
             (business_id, po_number, supplier_id, supplier_name_raw, location_id,
              status, order_date, expected_date, received_date, notes,
              payment_terms, supplier_invoice_number,
              tax_treatment, currency_code, exchange_rate,
              freight, discount, subtotal, tax_amount, total_amount, is_historical)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [businessId, poNumber, supplierId, supplierRaw, locationId,
           status,
           order.order_date,
           order.expected_date || null,
           order.received_date || null,
           order.notes         || null,
           order.payment_terms           || null,
           order.supplier_invoice_number || null,
           taxTreatment, currencyCode, exchangeRate,
           freight, discount, subtotal, taxAmount, totalAmount, isHistorical]
        );

        const poId = (res as any).insertId;

        for (const item of order.items) {
          const variantId  = item.sku ? (varMap.get(item.sku.trim().toLowerCase()) ?? null) : null;
          const qty        = Number(item.qty         || 0);
          const qtyRecv    = Number(item.qty_received ?? 0);
          const cost       = Number(item.unit_cost   || 0);
          const disc       = Number(item.discount_pct ?? 0);
          const rate       = Number(item.tax_rate    ?? 0);
          const lineTotal  = Math.round(qty * cost * (1 - disc / 100) * 10000) / 10000;
          const notes      = [item.product_name, !variantId && item.sku ? `(SKU: ${item.sku})` : '']
            .filter(Boolean).join(' ').slice(0, 500) || null;
          await imsExecute(
            `INSERT INTO ims_purchase_order_items
               (po_id, variant_id, qty_ordered, qty_received, unit_cost, discount_pct, tax_rate, line_total, notes)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [poId, variantId, qty, qtyRecv, cost, disc, rate, lineTotal, notes]
          );
        }

        created++;
      } catch (err: any) {
        errors.push(`PO "${order.po_number ?? `#${i + 1}`}": ${err.message}`);
      }
    }

    return NextResponse.json({ success: true, created, errors });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
