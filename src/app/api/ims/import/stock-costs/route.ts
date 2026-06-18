import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

// ── CSV parser (no dependencies) ──────────────────────────────────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let inQuote = false;
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === ',' && !inQuote) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

// ── Header detection ──────────────────────────────────────────────────────────
function findHeaderRow(rows: string[][]): { headerIdx: number; skuCol: number; qtyCol: number; valueCol: number } | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i].map(c => c.toLowerCase().trim());
    // Look for the SKU column — "size code" or "product code" or "sku" or "code"
    const skuCol =
      row.findIndex(c => c === 'size code') !== -1 ? row.findIndex(c => c === 'size code') :
      row.findIndex(c => c === 'sku')       !== -1 ? row.findIndex(c => c === 'sku') :
      row.findIndex(c => c === 'code')      !== -1 ? row.findIndex(c => c === 'code') :
      row.findIndex(c => c === 'product code') !== -1 ? row.findIndex(c => c === 'product code') :
      -1;
    // Stock Qty column
    const qtyCol = row.findIndex(c => c === 'stock qty' || c === 'qty' || c === 'quantity' || c === 'stockqty');
    // Stock Value column — first occurrence of "stock value" or "value"
    const valueCol = row.findIndex(c => c === 'stock value' || c === 'value' || c === 'stockvalue');

    if (skuCol !== -1 && qtyCol !== -1 && valueCol !== -1) {
      return { headerIdx: i, skuCol, qtyCol, valueCol };
    }
  }
  return null;
}

/**
 * POST /api/ims/import/stock-costs
 * Accepts a multipart/form-data body with a single "file" field (CSV).
 *
 * For each row in the CSV:
 *   avg_cost = Stock Value / Stock Qty   (skips rows with qty = 0 or value = 0)
 *
 * When the same SKU appears in multiple rows (one per branch), values are aggregated:
 *   total_qty   = sum of qty
 *   total_value = sum of value
 *   avg_cost    = total_value / total_qty
 *
 * Writes to:
 *   ims_product_variants.cost_aud   (the unit cost used by reports/POs)
 *   ims_stock.avg_cost             (the per-location average cost)
 */
export async function POST(req: Request) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let csvText: string;
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || typeof (file as File).text !== 'function') {
      return NextResponse.json({ error: 'No file uploaded. Send a multipart/form-data request with a "file" field.' }, { status: 400 });
    }
    csvText = await (file as File).text();
  } catch {
    return NextResponse.json({ error: 'Failed to read uploaded file.' }, { status: 400 });
  }

  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return NextResponse.json({ error: 'CSV appears empty or has only a header row.' }, { status: 400 });
  }

  const meta = findHeaderRow(rows);
  if (!meta) {
    return NextResponse.json({
      error: 'Could not locate required columns. Expected headers: "Size Code" (or "SKU"/"Code"), "Stock Qty", "Stock Value".',
    }, { status: 400 });
  }

  const { headerIdx, skuCol, qtyCol, valueCol } = meta;
  const dataRows = rows.slice(headerIdx + 1);

  // ── 1. Aggregate qty+value per SKU across all branches ───────────────────
  const aggBySku = new Map<string, { qty: number; value: number }>();
  for (const row of dataRows) {
    const sku   = (row[skuCol] ?? '').trim();
    const qty   = parseFloat((row[qtyCol]   ?? '0').replace(/,/g, '')) || 0;
    const value = parseFloat((row[valueCol] ?? '0').replace(/,/g, '')) || 0;
    if (!sku) continue;
    if (!aggBySku.has(sku)) aggBySku.set(sku, { qty: 0, value: 0 });
    const agg = aggBySku.get(sku)!;
    agg.qty   += qty;
    agg.value += value;
  }

  // ── 2. Load all variants from DB for matching ─────────────────────────────
  const variants = await imsQuery<{ variant_id: string; sku: string | null }>(
    'SELECT variant_id, sku FROM ims_product_variants WHERE is_active = 1',
  );
  const variantBySku = new Map<string, string>();
  for (const v of variants) {
    if (v.sku) variantBySku.set(v.sku.trim(), v.variant_id);
  }

  // ── 3. Apply updates ──────────────────────────────────────────────────────
  let updated = 0;
  let skippedNotFound = 0;
  let skippedZeroQty  = 0;
  const notFound: string[] = [];

  for (const [sku, agg] of aggBySku) {
    if (agg.qty <= 0 || agg.value <= 0) {
      skippedZeroQty++;
      continue;
    }
    const avgCost = Math.round((agg.value / agg.qty) * 10000) / 10000; // 4 dp

    const variantId = variantBySku.get(sku);
    if (!variantId) {
      skippedNotFound++;
      notFound.push(sku);
      continue;
    }

    // Update the canonical cost on the variant
    await imsExecute(
      'UPDATE ims_product_variants SET cost_aud = ? WHERE variant_id = ?',
      [avgCost, variantId],
    );
    // Update avg_cost on every stock row for this variant (all branches)
    await imsExecute(
      'UPDATE ims_stock SET avg_cost = ? WHERE variant_id = ?',
      [avgCost, variantId],
    );
    updated++;
  }

  return NextResponse.json({
    success: true,
    summary: {
      csvRowsRead:      dataRows.length,
      uniqueSkus:       aggBySku.size,
      updated,
      skippedNotFound,
      skippedZeroQty,
    },
    notFound: notFound.slice(0, 50), // cap to avoid huge responses
  });
}
