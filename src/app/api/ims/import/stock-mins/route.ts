import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

// ── CSV parser ────────────────────────────────────────────────────────────────
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

function findCol(row: string[], ...names: string[]): number {
  const lower = row.map(c => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const name of names) {
    const idx = lower.indexOf(name.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * POST /api/ims/import/stock-mins
 * Accepts multipart/form-data with a "file" CSV field.
 *
 * Designed to accept the Cin7 Omni Stocktake Master CSV export
 * (Update Mode: Replenishment Values) which includes:
 *   Code, Barcode, Name, Brand, Size, SafetyStockQty, OptimumStockQty, BranchName, BranchId
 *
 * Also accepts generic CSVs with flexible column names:
 *   SKU      — "Code", "SKU", "Size Code", "Product Code"
 *   Min Qty  — "SafetyStockQty", "Min Qty", "Min Stock", "Reorder Point"
 *   Reorder Qty — "OptimumStockQty", "Reorder Qty", "Reorder Quantity", "Order Qty"
 *   Location — "BranchName", "BranchId", "Branch", "Location" (optional; applies to all if omitted)
 *
 * Updates ims_stock.min_qty and ims_stock.reorder_qty only — does not touch qty_on_hand.
 *
 * Cin7 mapping:
 *   SafetyStockQty  → min_qty    (minimum safety buffer)
 *   OptimumStockQty → reorder_qty (target/optimum stock level)
 */
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId ?? '';

  let csvText: string;
  let locationIdOverride: number | null = null;
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
    csvText = await file.text();
    const locOverrideRaw = formData.get('location_id');
    if (locOverrideRaw) locationIdOverride = Number(locOverrideRaw) || null;
  } catch {
    return NextResponse.json({ error: 'Could not read uploaded file.' }, { status: 400 });
  }

  const rows = parseCsv(csvText);
  if (rows.length < 2) return NextResponse.json({ error: 'CSV has no data rows.' }, { status: 400 });

  // Find header row (scan first 10 rows)
  let headerIdx = -1;
  let skuCol = -1, minQtyCol = -1, reorderQtyCol = -1, locationCol = -1, branchIdCol = -1, barcodeCol = -1;

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    skuCol        = findCol(rows[i], 'Code', 'Size Code', 'SKU', 'Product Code', 'StyleCode', 'Style Code');
    minQtyCol     = findCol(rows[i], 'SafetyStockQty', 'Min Qty', 'Min Stock', 'Minimum', 'Reorder Point', 'reorderPoint', 'Min Level', 'MinQty', 'MinStock');
    reorderQtyCol = findCol(rows[i], 'OptimumStockQty', 'Reorder Qty', 'Reorder Quantity', 'reorderQty', 'Order Qty', 'OrderQty', 'ReorderQty');
    locationCol   = findCol(rows[i], 'BranchName', 'Branch Name', 'Location', 'Branch', 'Store');
    barcodeCol    = findCol(rows[i], 'Barcode', 'barcode', 'EAN', 'UPC', 'GTIN', 'Barcode Number');
    // BranchId as fallback location identifier
    if (locationCol === -1) branchIdCol = findCol(rows[i], 'BranchId', 'Branch Id', 'branchId');

    if (skuCol !== -1 && (minQtyCol !== -1 || reorderQtyCol !== -1)) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1 || skuCol === -1) {
    return NextResponse.json({
      error: 'Could not find required columns. Need: SKU (or "Size Code"/"Code") + at least one of "Min Qty" or "Reorder Qty".',
    }, { status: 400 });
  }

  // Load lookup maps
  const variants = await imsQuery<{ variant_id: string; sku: string | null; barcode: string | null; product_name: string | null; brand: string | null }>(
    `SELECT v.variant_id, v.sku, v.barcode, p.name AS product_name, p.brand
     FROM ims_product_variants v
     JOIN ims_products p ON p.product_id = v.product_id
     WHERE v.sku IS NOT NULL OR v.barcode IS NOT NULL`,
  );
  // Primary: exact SKU (lowercased)
  const variantBySku = new Map<string, string>();
  // Secondary: SKU with all spaces stripped
  const variantBySkuNoSpaces = new Map<string, string>();
  // Tertiary: barcode
  const variantByBarcode = new Map<string, string>();
  // Product info by variant_id (for enriching unmatched rows)
  const variantInfo = new Map<string, { product_name: string; brand: string }>();
  for (const v of variants) {
    if (v.sku) {
      const key = v.sku.trim().toLowerCase();
      variantBySku.set(key, v.variant_id);
      variantBySkuNoSpaces.set(key.replace(/\s+/g, ''), v.variant_id);
    }
    if (v.barcode) {
      variantByBarcode.set(v.barcode.trim().toLowerCase(), v.variant_id);
    }
    variantInfo.set(v.variant_id, { product_name: v.product_name ?? '', brand: v.brand ?? '' });
  }

  const locations = await imsQuery<{ id: number; name: string; cin7_branch_id: number | null }>(
    'SELECT id, name, cin7_branch_id FROM ims_locations',
  );
  const locByName    = new Map<string, number>(locations.map(l => [l.name.trim().toLowerCase(), l.id]));
  const locByBranchId = new Map<number, number>(
    locations.filter(l => l.cin7_branch_id != null).map(l => [l.cin7_branch_id!, l.id]),
  );

  let updated = 0;
  let skippedNoValue = 0;
  let matchedByExact = 0, matchedByNoSpaces = 0, matchedByBarcode = 0;

  // Full not-found list with categorisation
  type NotFoundRow = { code: string; barcode: string; reason: string; product_name: string; brand: string };
  const notFoundRows: NotFoundRow[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const sku = row[skuCol]?.trim();
    if (!sku) continue;

    const minQtyRaw    = minQtyCol     !== -1 ? row[minQtyCol]?.trim()     : undefined;
    const reorderRaw   = reorderQtyCol !== -1 ? row[reorderQtyCol]?.trim() : undefined;
    const locationName = locationCol   !== -1 ? row[locationCol]?.trim()   : undefined;
    const branchIdRaw  = branchIdCol   !== -1 ? row[branchIdCol]?.trim()   : undefined;
    const csvBarcode   = barcodeCol    !== -1 ? row[barcodeCol]?.trim()    : undefined;
    const branchIdNum  = branchIdRaw   ? Number(branchIdRaw) : undefined;

    const minQty     = minQtyRaw  ? parseFloat(minQtyRaw)  : null;
    const reorderQty = reorderRaw ? parseFloat(reorderRaw) : null;

    if (minQty === null && reorderQty === null) { skippedNoValue++; continue; }
    if ((minQty !== null && isNaN(minQty)) && (reorderQty !== null && isNaN(reorderQty))) { skippedNoValue++; continue; }

    // Lookup with tracking of which method matched
    let variantId: string | undefined;
    let matchMethod = '';
    const skuLower = sku.toLowerCase();

    if (variantBySku.has(skuLower)) {
      variantId = variantBySku.get(skuLower);
      matchMethod = 'exact';
      matchedByExact++;
    } else if (variantBySkuNoSpaces.has(skuLower.replace(/\s+/g, ''))) {
      variantId = variantBySkuNoSpaces.get(skuLower.replace(/\s+/g, ''));
      matchMethod = 'no_spaces';
      matchedByNoSpaces++;
    } else if (csvBarcode && variantByBarcode.has(csvBarcode.toLowerCase())) {
      variantId = variantByBarcode.get(csvBarcode.toLowerCase());
      matchMethod = 'barcode';
      matchedByBarcode++;
    }

    if (!variantId) {
      // Categorise the miss
      const skuHasSpaces = sku.includes(' ');
      const hasCsvBarcode = !!(csvBarcode);
      const reason = skuHasSpaces
        ? 'sku_has_spaces_no_match'
        : hasCsvBarcode
          ? 'barcode_also_not_in_ims'
          : 'not_in_ims';
      notFoundRows.push({ code: sku, barcode: csvBarcode ?? '', reason, product_name: '', brand: '' });
      continue;
    }

    // Build SET clause
    const sets: string[] = [];
    const vals: any[] = [];
    if (minQty !== null && !isNaN(minQty))         { sets.push('min_qty = ?');     vals.push(minQty); }
    if (reorderQty !== null && !isNaN(reorderQty)) { sets.push('reorder_qty = ?'); vals.push(reorderQty); }
    sets.push('updated_at = CURRENT_TIMESTAMP');
    const info = variantInfo.get(variantId) ?? { product_name: '', brand: '' };

    // Resolve location: override > BranchName > BranchId > apply to all
    let locationId: number | undefined;
    if (locationIdOverride) {
      locationId = locationIdOverride;
    } else {
      const locationKey = locationName || branchIdRaw;
      if (locationName) {
        locationId = locByName.get(locationName.toLowerCase());
      } else if (branchIdNum != null && !isNaN(branchIdNum)) {
        locationId = locByBranchId.get(branchIdNum);
      }

      if (locationKey && !locationId) {
        // Location column present but couldn't match — skip
        notFoundRows.push({ code: sku, barcode: csvBarcode ?? '', reason: 'location_not_matched', product_name: '', brand: '' });
        continue;
      }
    }

    if (locationId) {
      // Upsert: if the stock row doesn't exist yet, create it with qty_on_hand = 0 and set the
      // min/reorder values. COALESCE keeps the existing value when only one field is in the CSV.
      await imsExecute(
        `INSERT INTO ims_stock (business_id, variant_id, location_id, min_qty, reorder_qty)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           min_qty     = COALESCE(VALUES(min_qty),     min_qty),
           reorder_qty = COALESCE(VALUES(reorder_qty), reorder_qty),
           updated_at  = CURRENT_TIMESTAMP`,
        [businessId, variantId, locationId, minQty ?? null, reorderQty ?? null],
      );
      updated++;
    } else {
      // Apply to all existing locations for this variant
      const affected = await imsExecute(
        `UPDATE ims_stock SET ${sets.join(', ')} WHERE variant_id = ?`,
        [...vals, variantId],
      );
      if (affected.affectedRows > 0) updated += affected.affectedRows;
      else notFoundRows.push({ code: sku, barcode: csvBarcode ?? '', reason: 'no_stock_row', ...info });
    }
  }

  // Group not-found rows by reason for easy diagnosis
  const notFoundByReason: Record<string, NotFoundRow[]> = {};
  for (const r of notFoundRows) {
    if (!notFoundByReason[r.reason]) notFoundByReason[r.reason] = [];
    notFoundByReason[r.reason].push(r);
  }

  return NextResponse.json({
    success: true,
    summary: {
      csvRowsRead:        rows.length - headerIdx - 1,
      updated,
      matchedByExact,
      matchedByNoSpaces,
      matchedByBarcode,
      skippedNoValue,
      skippedNotFound:    notFoundRows.length,
    },
    notFoundByReason,          // full list grouped by cause
    notFound: notFoundRows.slice(0, 20).map(r => r.code),  // backward-compat preview
  });
}
