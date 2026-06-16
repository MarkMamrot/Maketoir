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
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let csvText: string;
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
    csvText = await file.text();
  } catch {
    return NextResponse.json({ error: 'Could not read uploaded file.' }, { status: 400 });
  }

  const rows = parseCsv(csvText);
  if (rows.length < 2) return NextResponse.json({ error: 'CSV has no data rows.' }, { status: 400 });

  // Find header row (scan first 10 rows)
  let headerIdx = -1;
  let skuCol = -1, minQtyCol = -1, reorderQtyCol = -1, locationCol = -1, branchIdCol = -1;

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    skuCol        = findCol(rows[i], 'Code', 'Size Code', 'SKU', 'Product Code', 'StyleCode', 'Style Code');
    minQtyCol     = findCol(rows[i], 'SafetyStockQty', 'Min Qty', 'Min Stock', 'Minimum', 'Reorder Point', 'reorderPoint', 'Min Level', 'MinQty', 'MinStock');
    reorderQtyCol = findCol(rows[i], 'OptimumStockQty', 'Reorder Qty', 'Reorder Quantity', 'reorderQty', 'Order Qty', 'OrderQty', 'ReorderQty');
    locationCol   = findCol(rows[i], 'BranchName', 'Branch Name', 'Location', 'Branch', 'Store');
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
  const variants = await imsQuery<{ variant_id: string; sku: string | null }>(
    'SELECT variant_id, sku FROM ims_product_variants WHERE sku IS NOT NULL',
  );
  const variantBySku = new Map<string, string>(variants.map(v => [v.sku!.trim().toLowerCase(), v.variant_id]));

  const locations = await imsQuery<{ id: number; name: string; cin7_branch_id: number | null }>(
    'SELECT id, name, cin7_branch_id FROM ims_locations',
  );
  const locByName    = new Map<string, number>(locations.map(l => [l.name.trim().toLowerCase(), l.id]));
  const locByBranchId = new Map<number, number>(
    locations.filter(l => l.cin7_branch_id != null).map(l => [l.cin7_branch_id!, l.id]),
  );

  let updated = 0;
  let skippedNotFound = 0;
  let skippedNoValue = 0;
  const notFound: string[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const sku = row[skuCol]?.trim();
    if (!sku) continue;

    const minQtyRaw    = minQtyCol   !== -1 ? row[minQtyCol]?.trim()   : undefined;
    const reorderRaw   = reorderQtyCol !== -1 ? row[reorderQtyCol]?.trim() : undefined;
    const locationName  = locationCol  !== -1 ? row[locationCol]?.trim()  : undefined;
    const branchIdRaw   = branchIdCol  !== -1 ? row[branchIdCol]?.trim()  : undefined;
    const branchIdNum   = branchIdRaw  ? Number(branchIdRaw) : undefined;

    const minQty    = minQtyRaw    ? parseFloat(minQtyRaw)    : null;
    const reorderQty = reorderRaw  ? parseFloat(reorderRaw)   : null;

    if (minQty === null && reorderQty === null) { skippedNoValue++; continue; }
    if ((minQty !== null && isNaN(minQty)) && (reorderQty !== null && isNaN(reorderQty))) { skippedNoValue++; continue; }

    const variantId = variantBySku.get(sku.toLowerCase());
    if (!variantId) {
      skippedNotFound++;
      if (!notFound.includes(sku) && notFound.length < 20) notFound.push(sku);
      continue;
    }

    // Build the SET clause dynamically
    const sets: string[] = [];
    const vals: any[] = [];
    if (minQty !== null && !isNaN(minQty))      { sets.push('min_qty = ?');     vals.push(minQty); }
    if (reorderQty !== null && !isNaN(reorderQty)) { sets.push('reorder_qty = ?'); vals.push(reorderQty); }
    sets.push('updated_at = CURRENT_TIMESTAMP');

    // Resolve location: BranchName > BranchId > apply to all
    let locationId: number | undefined;
    const locationKey = locationName || branchIdRaw;
    if (locationName) {
      locationId = locByName.get(locationName.toLowerCase());
    } else if (branchIdNum != null && !isNaN(branchIdNum)) {
      locationId = locByBranchId.get(branchIdNum);
    }

    if (locationKey && !locationId) {
      // Location column present but couldn't match — skip
      skippedNotFound++;
      if (notFound.length < 20) notFound.push(`${sku} (location: ${locationKey})`);
      continue;
    }

    if (locationId) {
      const affected = await imsExecute(
        `UPDATE ims_stock SET ${sets.join(', ')} WHERE variant_id = ? AND location_id = ?`,
        [...vals, variantId, locationId],
      );
      if (affected.affectedRows > 0) updated++;
      else skippedNotFound++;
    } else {
      // Apply to all locations for this variant
      const affected = await imsExecute(
        `UPDATE ims_stock SET ${sets.join(', ')} WHERE variant_id = ?`,
        [...vals, variantId],
      );
      if (affected.affectedRows > 0) updated += affected.affectedRows;
      else skippedNotFound++;
    }
  }

  return NextResponse.json({
    success: true,
    summary: {
      csvRowsRead: rows.length - headerIdx - 1,
      updated,
      skippedNotFound,
      skippedNoValue,
    },
    notFound,
  });
}
