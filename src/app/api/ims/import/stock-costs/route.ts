import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';


// ── CSV parser (no dependencies) ──────────────────────────────────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (!lines.length) return rows;
  // Auto-detect delimiter: tab wins if any non-empty line has more tabs than commas
  const sample = lines.find(l => l.trim()) ?? '';
  const delim = (sample.split('\t').length - 1) >= (sample.split(',').length - 1) ? '\t' : ',';
  for (const line of lines) {
    if (!line.trim()) continue;
    if (delim === '\t') {
      rows.push(line.split('\t').map(c => c.trim()));
      continue;
    }
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

  // ── Headerless fallback: if the first row looks like data (col 0 is a SKU-like
  //    string, col 1 is numeric, col 2 is numeric) assume SKU | Qty | Value ──
  if (rows[0] && rows[0].length >= 3) {
    const [c0, c1, c2] = rows[0];
    const looksLikeSku   = /^[A-Za-z0-9]/.test(c0) && !c0.includes(' ');
    const looksLikeNum1  = !isNaN(parseFloat(c1.replace(/,/g, '')));
    const looksLikeNum2  = !isNaN(parseFloat(c2.replace(/,/g, '')));
    if (looksLikeSku && looksLikeNum1 && looksLikeNum2) {
      return { headerIdx: -1, skuCol: 0, qtyCol: 1, valueCol: 2 };
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
  if (!await getImsSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

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
  const dataRows = rows.slice(headerIdx + 1); // headerIdx=-1 means no header → slice(0) = all rows

  // ── 1. Aggregate qty+value per SKU across all branches ───────────────────
  // Keys are normalised to lowercase to avoid case-sensitivity issues
  const aggBySku = new Map<string, { qty: number; value: number; originalSku: string }>();
  for (const row of dataRows) {
    const rawSku = (row[skuCol] ?? '').trim();
    const sku    = rawSku.toLowerCase();
    const qty    = parseFloat((row[qtyCol]   ?? '0').replace(/,/g, '')) || 0;
    const value  = parseFloat((row[valueCol] ?? '0').replace(/,/g, '')) || 0;
    if (!sku) continue;
    if (!aggBySku.has(sku)) aggBySku.set(sku, { qty: 0, value: 0, originalSku: rawSku });
    const agg = aggBySku.get(sku)!;
    agg.qty   += qty;
    agg.value += value;
  }

  // ── 2. Load all variants from DB for matching ─────────────────────────────
  const variants = await imsQuery<{ variant_id: string; sku: string | null }>(
    'SELECT variant_id, sku FROM ims_product_variants WHERE is_active = 1',
  );
  const variantBySku = new Map<string, string>(); // key = lowercase sku
  for (const v of variants) {
    if (v.sku) variantBySku.set(v.sku.trim().toLowerCase(), v.variant_id);
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

    // ── Try exact SKU match first (both sides already lowercase) ───────────
    const exactVariantId = variantBySku.get(sku);
    if (exactVariantId) {
      await imsExecute(
        'UPDATE ims_product_variants SET cost_aud = ?, avg_cost = ? WHERE variant_id = ?',
        [avgCost, avgCost, exactVariantId],
      );
      await imsExecute(
        'UPDATE ims_stock SET avg_cost = ? WHERE variant_id = ?',
        [avgCost, exactVariantId],
      );
      updated++;
      continue;
    }

    // ── Fallback: product-level prefix match (e.g. CSV has "MT-RCA70sSurf",
    //    variants are "MT-RCA70sSurf-SM", "MT-RCA70sSurf-ML", etc.)
    //    LOWER() on both sides guarantees case-insensitive match regardless of collation ──
    const prefixVariants = await imsQuery<{ variant_id: string }>(
      'SELECT variant_id FROM ims_product_variants WHERE LOWER(sku) LIKE ? AND is_active = 1',
      [`${sku}-%`],
    );
    if (prefixVariants.length > 0) {
      for (const { variant_id } of prefixVariants) {
        await imsExecute(
          'UPDATE ims_product_variants SET cost_aud = ?, avg_cost = ? WHERE variant_id = ?',
          [avgCost, avgCost, variant_id],
        );
        await imsExecute(
          'UPDATE ims_stock SET avg_cost = ? WHERE variant_id = ?',
          [avgCost, variant_id],
        );
      }
      updated += prefixVariants.length;
      continue;
    }

    skippedNotFound++;
    notFound.push(agg.originalSku); // report the original casing for easier debugging
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
