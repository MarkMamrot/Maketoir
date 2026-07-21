import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { ImsStockRepo } from '@/lib/ims/ImsRepository';

// ── Sync Zone/Bin between product-level and variant-level ──────────────────
//
// Zone/bin lives in two places:
//   1. ims_products.zone / ims_products.bin   (product-level default)
//   2. ims_product_variants.zone / ims_product_variants.bin  (per-variant)
//
// The stock panel at any location shows ims_products.zone/bin via JOIN.
// This utility scopes work to variants that have a stock row at the chosen
// location, then reconciles the two storage layers.
//
// Resolution rules (applied independently for zone and for bin):
//   - Both blank/null          → no change (Healthy)
//   - Product has value, variant blank  → copy product → variant  (Fill)
//   - Variant has value, product blank  → copy variant → product  (Fill)
//   - Both same value          → no change (Healthy)
//   - Both have DIFFERENT values → flag as Conflict — user must choose which to use


export interface SyncZoneBinDiff {
  product_id:    string;
  variant_id:    string;
  product_name:  string;
  sku:           string | null;
  variant_label: string | null;
  // Zone
  zone_product:  string | null;
  zone_variant:  string | null;
  zone_status:   'healthy' | 'fill_variant' | 'fill_product' | 'conflict';
  zone_resolution: string | null; // null until user chooses
  // Bin
  bin_product:   string | null;
  bin_variant:   string | null;
  bin_status:    'healthy' | 'fill_variant' | 'fill_product' | 'conflict';
  bin_resolution: string | null;
}

/** GET — analyse differences for a given location. */
export async function GET(req: Request) {
  if (!await getImsSession()) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const locationId = parseInt(searchParams.get('location_id') ?? '0', 10);
  if (!locationId) return NextResponse.json({ success: false, error: 'location_id required' }, { status: 400 });

  try {
    const rows = await imsQuery<{
      product_id: string;
      variant_id: string;
      product_name: string;
      sku: string | null;
      option1_value: string | null;
      option2_value: string | null;
      option3_value: string | null;
      zone_product: string | null;
      zone_variant: string | null;
      bin_product:  string | null;
      bin_variant:  string | null;
    }>(
      `SELECT
         p.product_id,
         v.variant_id,
         p.name AS product_name,
         v.sku,
         v.option1_value, v.option2_value, v.option3_value,
         p.zone  AS zone_product,
         v.zone  AS zone_variant,
         p.bin   AS bin_product,
         v.bin   AS bin_variant
       FROM ims_stock s
       JOIN ims_product_variants v ON v.variant_id = s.variant_id
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE s.location_id = ?
         AND v.is_active = 1 AND p.is_active = 1
       ORDER BY p.name, v.sku`,
      [locationId],
    );

    const diffs: SyncZoneBinDiff[] = rows.map(r => {
      const optLabel = [r.option1_value, r.option2_value, r.option3_value].filter(Boolean).join(' / ') || null;

      function classify(
        prodVal: string | null,
        varVal:  string | null,
      ): { status: SyncZoneBinDiff['zone_status']; fill: string | null } {
        const p = prodVal?.trim() || null;
        const v = varVal?.trim()  || null;
        if (!p && !v) return { status: 'healthy', fill: null };
        if (p && !v)  return { status: 'fill_variant', fill: p };
        if (!p && v)  return { status: 'fill_product',  fill: v };
        if (p === v)  return { status: 'healthy', fill: null };
        return         { status: 'conflict', fill: null };
      }

      const zoneC = classify(r.zone_product, r.zone_variant);
      const binC  = classify(r.bin_product,  r.bin_variant);

      return {
        product_id:    r.product_id,
        variant_id:    r.variant_id,
        product_name:  r.product_name,
        sku:           r.sku,
        variant_label: optLabel,
        zone_product:  r.zone_product?.trim() || null,
        zone_variant:  r.zone_variant?.trim() || null,
        zone_status:   zoneC.status,
        zone_resolution: zoneC.fill,   // auto-resolved value for fill cases; null = needs user input
        bin_product:   r.bin_product?.trim() || null,
        bin_variant:   r.bin_variant?.trim() || null,
        bin_status:    binC.status,
        bin_resolution: binC.fill,
      };
    });

    const summary = {
      total:         diffs.length,
      healthy:       diffs.filter(d => d.zone_status === 'healthy' && d.bin_status === 'healthy').length,
      fill:          diffs.filter(d => d.zone_status !== 'healthy' || d.bin_status !== 'healthy').length,
      conflicts:     diffs.filter(d => d.zone_status === 'conflict' || d.bin_status === 'conflict').length,
    };

    // Pass location_id so the POST can write to ims_stock rows too
  return NextResponse.json({ success: true, diffs, summary, location_id: locationId });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/** POST — apply the resolved diffs. */
export async function POST(req: Request) {
  if (!await getImsSession()) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

  try {
    const body: { diffs: SyncZoneBinDiff[]; location_id: number } = await req.json();
    const diffs      = body.diffs ?? [];
    const locationId = body.location_id ? Number(body.location_id) : null;

    let updatedProducts = 0;
    let updatedVariants = 0;
    let updatedStockRows = 0;

    // Ensure ims_stock has zone/bin columns before any writes.
    await ImsStockRepo.ensureZoneBinColumns();

    // Group by product_id to batch product-level writes
    const byProduct = new Map<string, { zone: string | null; bin: string | null }>();

    for (const d of diffs) {
      // Determine final zone/bin values after resolution
      const finalZone = resolveField(d.zone_status, d.zone_product, d.zone_variant, d.zone_resolution);
      const finalBin  = resolveField(d.bin_status,  d.bin_product,  d.bin_variant,  d.bin_resolution);

      // Variant update (only if the variant value needs to change)
      const variantZoneChanged = finalZone !== (d.zone_variant?.trim() || null);
      const variantBinChanged  = finalBin  !== (d.bin_variant?.trim()  || null);

      if (variantZoneChanged || variantBinChanged) {
        await imsExecute(
          `UPDATE ims_product_variants SET zone = ?, bin = ?, updated_at = NOW() WHERE variant_id = ?`,
          [finalZone, finalBin, d.variant_id],
        );
        updatedVariants++;
      }

      // Also upsert the ims_stock row for the chosen location so the stock panel reflects the
      // new zone/bin. Creates a 0-qty row if no stock record exists yet (safe — DEFAULT values
      // are all 0 and the min_qty/reorder_qty on existing rows are never overwritten).
      if (locationId && (finalZone !== null || finalBin !== null)) {
        await ImsStockRepo.upsert(d.variant_id, locationId, { zone: finalZone, bin: finalBin });
        updatedStockRows++;
      }

      // Accumulate the "desired" product-level zone/bin.
      // Multiple variants for the same product may have different zone/bin — last-write wins
      // per standard behaviour (they should all agree after harmonisation).
      const existing = byProduct.get(d.product_id);
      byProduct.set(d.product_id, {
        zone: finalZone ?? existing?.zone ?? null,
        bin:  finalBin  ?? existing?.bin  ?? null,
      });
    }

    // Write product-level updates
    for (const [productId, vals] of byProduct) {
      const productZoneChanged = diffs.some(d => d.product_id === productId &&
        resolveField(d.zone_status, d.zone_product, d.zone_variant, d.zone_resolution) !== (d.zone_product?.trim() || null));
      const productBinChanged  = diffs.some(d => d.product_id === productId &&
        resolveField(d.bin_status,  d.bin_product,  d.bin_variant,  d.bin_resolution) !== (d.bin_product?.trim() || null));

      if (productZoneChanged || productBinChanged) {
        await imsExecute(
          `UPDATE ims_products SET zone = ?, bin = ?, updated_at = NOW() WHERE product_id = ?`,
          [vals.zone, vals.bin, productId],
        );
        updatedProducts++;
      }
    }

    return NextResponse.json({ success: true, updatedProducts, updatedVariants, updatedStockRows });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

function resolveField(
  status: SyncZoneBinDiff['zone_status'],
  productVal: string | null,
  variantVal: string | null,
  resolution: string | null,
): string | null {
  if (status === 'healthy') return productVal?.trim() || null; // both same or both empty
  if (status === 'fill_variant') return productVal?.trim() || null; // product → variant
  if (status === 'fill_product')  return variantVal?.trim() || null; // variant → product
  // conflict: use whatever the user chose (resolution may be productVal, variantVal, or custom)
  return resolution?.trim() || null;
}
