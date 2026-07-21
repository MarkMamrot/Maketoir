import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';


interface ImportSOItem {
  sku?: string;
  product_name?: string;
  qty: number;
  unit_price: number;
  discount_pct?: number;
  tax_rate?: number;
}

interface ImportSORow {
  so_number?: string;
  order_date: string;
  fulfilled_date?: string;
  customer_name?: string;
  location_name: string;
  status: string;
  so_type?: string;
  price_tier?: string;
  tax_treatment?: string;
  payment_terms?: string;
  customer_po_number?: string;
  notes?: string;
  freight?: number;
  discount?: number;
  items: ImportSOItem[];
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;

  try {
    const body = await req.json();
    const orders: ImportSORow[] = body.orders ?? [];
    if (!orders.length) return NextResponse.json({ success: false, error: 'No orders provided.' }, { status: 400 });

    // Load reference lookups
    const contacts = await imsQuery<{ id: number; name: string }>(
      'SELECT id, name FROM ims_contacts WHERE business_id = ?', [businessId]
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

    const contactMap = new Map(contacts.map(c => [c.name.trim().toLowerCase(), c.id]));
    const locMap     = new Map(locs.map(l => [l.name.trim().toLowerCase(), l.id]));
    const varMap     = new Map(vars.filter(v => v.sku).map(v => [v.sku!.trim().toLowerCase(), v.variant_id]));

    // Collect provided SO numbers and check for existing duplicates
    const providedNums = [...new Set(orders.map(o => o.so_number?.trim()).filter(Boolean) as string[])];
    const existingSet = new Set<string>();
    if (providedNums.length) {
      const ph = providedNums.map(() => '?').join(',');
      const existing = await imsQuery<{ so_number: string }>(
        `SELECT so_number FROM ims_sales_orders WHERE so_number IN (${ph}) AND business_id = ?`,
        [...providedNums, businessId]
      );
      existing.forEach(r => existingSet.add(r.so_number));
    }

    // Auto-number sequence seed
    const year = new Date().getFullYear();
    const seqRows = await imsQuery<{ max_seq: number | null }>(
      `SELECT MAX(CAST(SUBSTRING_INDEX(so_number, '-', -1) AS UNSIGNED)) AS max_seq
         FROM ims_sales_orders
        WHERE so_number LIKE ?`,
      [`SO-${year}-%`]
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
          errors.push(`SO "${order.so_number ?? `#${i + 1}`}": location "${order.location_name}" not found.`);
          continue;
        }

        // Resolve SO number (auto-assign if blank)
        const soNumber = order.so_number?.trim() || `SO-${year}-${String(seq++).padStart(4, '0')}`;

        // Skip duplicates (existing in DB or earlier in this batch)
        if (existingSet.has(soNumber) || seenInBatch.has(soNumber)) {
          errors.push(`SO "${soNumber}": already exists — skipped.`);
          continue;
        }
        seenInBatch.add(soNumber);

        // Optional: resolve customer by name
        const customerId = order.customer_name
          ? (contactMap.get(order.customer_name.trim().toLowerCase()) ?? null)
          : null;

        // Normalise status
        const status = (['draft', 'confirmed', 'fulfilled', 'cancelled'] as const)
          .includes(order.status as any) ? order.status as string : 'draft';

        // Historical = fulfilled or cancelled (no accounting sync)
        const isHistorical = (status === 'fulfilled' || status === 'cancelled') ? 1 : 0;

        const soType       = (['b2b', 'online', 'pos'] as const).includes(order.so_type as any)
          ? order.so_type as string : 'b2b';
        const priceTier    = order.price_tier === 'wholesale' ? 'wholesale' : 'retail';
        const taxTreatment = (['ex_tax', 'inc_tax', 'no_tax'] as const).includes(order.tax_treatment as any)
          ? order.tax_treatment as 'ex_tax' | 'inc_tax' | 'no_tax' : 'ex_tax';
        const freight  = Number(order.freight  ?? 0);
        const discount = Number(order.discount ?? 0);

        // Compute totals from items
        let subtotal  = 0;
        let taxAmount = 0;
        for (const item of order.items) {
          const qty   = Number(item.qty        || 0);
          const price = Number(item.unit_price || 0);
          const disc  = Number(item.discount_pct ?? 0);
          const rate  = Number(item.tax_rate   ?? 0);
          const line  = qty * price * (1 - disc / 100);
          if (taxTreatment === 'inc_tax' && rate > 0) {
            const exTax = line / (1 + rate);
            subtotal  += Math.round(exTax         * 100) / 100;
            taxAmount += Math.round((line - exTax) * 100) / 100;
          } else if (taxTreatment === 'ex_tax') {
            subtotal  += line;
            taxAmount += Math.round(line * rate   * 100) / 100;
          } else {
            subtotal  += line;
          }
        }
        subtotal  = Math.round(subtotal  * 100) / 100;
        taxAmount = taxTreatment === 'no_tax' ? 0 : Math.round(taxAmount * 100) / 100;
        const totalAmount = Math.round((subtotal + taxAmount + freight - discount) * 100) / 100;

        const res: any = await imsExecute(
          `INSERT INTO ims_sales_orders
             (business_id, so_number, so_type, customer_id, customer_po_number, location_id,
              status, order_date, fulfilled_date, notes, payment_terms,
              price_tier, tax_treatment,
              freight, discount, subtotal, tax_amount, total_amount, is_historical)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [businessId, soNumber, soType, customerId, order.customer_po_number || null, locationId,
           status,
           order.order_date,
           order.fulfilled_date || null,
           order.notes || null,
           order.payment_terms || null,
           priceTier, taxTreatment,
           freight, discount, subtotal, taxAmount, totalAmount, isHistorical]
        );

        const soId = (res as any).insertId;

        for (const item of order.items) {
          const variantId = item.sku ? (varMap.get(item.sku.trim().toLowerCase()) ?? null) : null;
          const qty       = Number(item.qty        || 0);
          const price     = Number(item.unit_price || 0);
          const disc      = Number(item.discount_pct ?? 0);
          const rate      = Number(item.tax_rate   ?? 0);
          const lineTotal = Math.round(qty * price * (1 - disc / 100) * 100) / 100;
          // Store product name / SKU in notes so unlinked items are identifiable
          const notes = [item.product_name, !variantId && item.sku ? `(SKU: ${item.sku})` : '']
            .filter(Boolean).join(' ').slice(0, 500) || null;
          await imsExecute(
            `INSERT INTO ims_sales_order_items
               (so_id, variant_id, qty_ordered, unit_price, discount_pct, tax_rate, line_total, notes)
             VALUES (?,?,?,?,?,?,?,?)`,
            [soId, variantId, qty, price, disc, rate, lineTotal, notes]
          );
        }

        created++;
      } catch (err: any) {
        errors.push(`SO "${order.so_number ?? `#${i + 1}`}": ${err.message}`);
      }
    }

    return NextResponse.json({ success: true, created, errors });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
