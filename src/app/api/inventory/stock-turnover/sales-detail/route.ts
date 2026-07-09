import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

// ── Stock Turnover — per-variant sales drill-down ─────────────────────────────
//
// Diagnostic endpoint: returns EVERY sales record for a variant across all channels,
// pulled live from the raw tables (POS, Sales Orders, and ims_sales_history) so the
// counted `ims_sales_cache` value can be reconciled against reality. Rows are linked
// by variant_id, and — because historical lines can carry a NULL variant_id — also by
// SKU / cin7_option_id, with a `linkedBy` flag so unlinked sales are visible.

const DAY_MS = 24 * 60 * 60 * 1000;

function round(v: number, p = 2): number {
  const f = 10 ** p;
  return Math.round(v * f) / f;
}

interface SaleRow {
  channel:   'pos' | 'wholesale' | 'online' | 'history';
  date:      string | null;
  qty:       number;
  status:    string;
  reference: string;
  linkedBy:  'variant_id' | 'sku' | 'cin7_option_id';
  counted:   boolean;      // does the current cache logic count this row?
  note:      string;
}

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const variantId = String(body?.variantId ?? '').trim();
  if (!variantId) {
    return NextResponse.json({ success: false, error: 'variantId is required.' }, { status: 400 });
  }

  try {
    // 1. Resolve the variant's identity (sku + cin7_option_id) for orphan matching.
    const vRows = await imsQuery<{ variant_id: string; sku: string | null; cin7_option_id: number | null; product_name: string | null }>(
      `SELECT v.variant_id, v.sku, v.cin7_option_id, p.name AS product_name
         FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
        WHERE v.variant_id = ? LIMIT 1`,
      [variantId],
    );
    if (vRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Variant not found.' }, { status: 404 });
    }
    const variant = vRows[0];
    const sku = variant.sku ?? null;
    const optId = variant.cin7_option_id ?? null;

    const now = Date.now();
    const within365 = (d: string | null) =>
      d != null && (now - new Date(d).getTime()) <= 365 * DAY_MS;

    // 2. POS lines (linked by variant_id, or by SKU when variant_id is NULL).
    const posRows = await imsQuery<{
      completed_at: string | null; qty: number; status: string; sale_type: string;
      is_historical: number; location: string | null; ref: string | null; own_variant: string | null;
    }>(
      `SELECT ps.completed_at, psi.qty, ps.status, ps.sale_type, ps.is_historical,
              l.name AS location, ps.customer_name AS ref, psi.variant_id AS own_variant
         FROM pos_sale_items psi
         JOIN pos_sales ps ON ps.id = psi.sale_id
         LEFT JOIN ims_locations l ON l.id = ps.location_id
        WHERE psi.variant_id = ?
           OR (psi.variant_id IS NULL AND ? IS NOT NULL AND psi.code = ?)
        ORDER BY ps.completed_at DESC`,
      [variantId, sku, sku],
    );

    // 3. Sales-order lines (wholesale + online).
    const soRows = await imsQuery<{
      order_date: string | null; qty_ordered: number; qty_fulfilled: number; status: string;
      so_type: string; is_historical: number; so_number: string | null; cin7_order_id: string | null; own_variant: string | null;
    }>(
      `SELECT so.order_date, soi.qty_ordered, soi.qty_fulfilled, so.status, so.so_type,
              so.is_historical, so.so_number, so.cin7_order_id, soi.variant_id AS own_variant
         FROM ims_sales_order_items soi
         JOIN ims_sales_orders so ON so.id = soi.so_id
        WHERE soi.variant_id = ?
           OR (soi.variant_id IS NULL AND ? IS NOT NULL AND soi.code = ?)
        ORDER BY so.order_date DESC`,
      [variantId, sku, sku],
    );

    // 4. Historical Cin7 lines (informational — not a cache source any more).
    const histRows = await imsQuery<{
      invoice_date: string | null; qty: number; source: string | null; reference: string | null;
      stage: string | null; own_variant: string | null;
    }>(
      `SELECT invoice_date, qty, source, reference, stage, variant_id AS own_variant
         FROM ims_sales_history
        WHERE variant_id = ?
           OR (? IS NOT NULL AND sku = ?)
           OR (? IS NOT NULL AND cin7_option_id = ?)
        ORDER BY invoice_date DESC`,
      [variantId, sku, sku, optId, optId],
    );

    // 5. What the cache currently stores for this variant.
    const cacheRows = await imsQuery<{ sales_qty_7d: number; sales_qty_90d: number; sales_qty_180d: number; sales_qty_12m: number; updated_at: string | null }>(
      `SELECT sales_qty_7d, sales_qty_90d, sales_qty_180d, sales_qty_12m, updated_at
         FROM ims_sales_cache WHERE variant_id = ? LIMIT 1`,
      [variantId],
    );

    // ── Shape rows + compute the counted flag to match cacheHelper logic ──
    // The cache counts: complete Cin7 history (all channels), plus LIVE POS (is_historical=0) and
    // LIVE sales orders (cin7_order_id IS NULL). Cin7-synced POS/SO rows are counted via history, so
    // here they are shown as excluded ("via history") to avoid implying a double count.
    const rows: SaleRow[] = [];

    for (const r of posRows) {
      const linkedBy: SaleRow['linkedBy'] = r.own_variant ? 'variant_id' : 'sku';
      const isLive  = Number(r.is_historical) === 0;
      const counted = isLive && r.status === 'completed' && r.sale_type === 'sale' && within365(r.completed_at);
      rows.push({
        channel: 'pos',
        date: r.completed_at ? String(r.completed_at).slice(0, 10) : null,
        qty: Number(r.qty ?? 0),
        status: `${r.status}${r.sale_type !== 'sale' ? ` / ${r.sale_type}` : ''}${r.is_historical ? ' · hist' : ''}`,
        reference: r.ref || r.location || 'POS',
        linkedBy,
        counted,
        note: counted
          ? (linkedBy === 'sku' ? 'counted via SKU fallback' : '')
          : (r.is_historical ? 'counted via Cin7 history' : r.sale_type !== 'sale' ? 'excluded: not a sale' : r.status !== 'completed' ? `excluded: status ${r.status}` : 'excluded: older than 365d'),
      });
    }

    for (const r of soRows) {
      const linkedBy: SaleRow['linkedBy'] = r.own_variant ? 'variant_id' : 'sku';
      const isSale = !['draft', 'cancelled'].includes((r.status || '').toLowerCase());
      const isLive = r.cin7_order_id == null;
      const counted = isLive && isSale && within365(r.order_date);
      rows.push({
        channel: r.so_type === 'online' ? 'online' : 'wholesale',
        date: r.order_date ? String(r.order_date).slice(0, 10) : null,
        qty: Number(r.qty_ordered ?? 0),
        status: `${r.status}${r.is_historical ? ' · hist' : ''}${Number(r.qty_fulfilled) !== Number(r.qty_ordered) ? ` · fulfilled ${round(Number(r.qty_fulfilled))}` : ''}`,
        reference: r.so_number || '—',
        linkedBy,
        counted,
        note: counted
          ? (linkedBy === 'sku' ? 'counted via SKU fallback' : '')
          : (!isLive ? 'counted via Cin7 history' : !isSale ? `excluded: status ${r.status}` : 'excluded: older than 365d'),
      });
    }

    for (const r of histRows) {
      const linkedBy: SaleRow['linkedBy'] = r.own_variant ? 'variant_id' : (sku ? 'sku' : 'cin7_option_id');
      const counted = within365(r.invoice_date);
      rows.push({
        channel: 'history',
        date: r.invoice_date ? String(r.invoice_date).slice(0, 10) : null,
        qty: Number(r.qty ?? 0),
        status: `${r.stage || r.source || 'Cin7'}`,
        reference: r.reference || '—',
        linkedBy,
        counted,
        note: counted ? 'counted (Cin7 history)' : 'excluded: older than 365d',
      });
    }

    // ── Totals ──
    const sum = (pred: (r: SaleRow) => boolean) => round(rows.filter(pred).reduce((s, r) => s + r.qty, 0));
    const countedTotal   = sum(r => r.counted);
    const posTotal       = sum(r => r.channel === 'pos');
    const wholesaleTotal = sum(r => r.channel === 'wholesale');
    const onlineTotal    = sum(r => r.channel === 'online');
    const historyTotal   = sum(r => r.channel === 'history');
    const uncounted      = sum(r => !r.counted);

    return NextResponse.json({
      success: true,
      variant: {
        variantId: variant.variant_id,
        sku,
        cin7OptionId: optId,
        name: variant.product_name ?? '',
      },
      cache: cacheRows[0] ?? null,
      rows,
      totals: {
        counted: countedTotal,
        uncounted,
        pos: posTotal,
        wholesale: wholesaleTotal,
        online: onlineTotal,
        history: historyTotal,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Failed to load sales detail: ${e.message}` }, { status: 500 });
  }
}
