import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { CachedProduct } from '@/app/pos/_types';
import { isBuildFromSaleEnabled, isBuildsEnabled } from '@/lib/ims/builds/buildFromSalePolicy';
import { DEFAULT_BUSINESS_TIME_ZONE, isValidBusinessTimeZone } from '@/lib/ims/businessTimeZoneValue';

export async function catalogueSettings(connection: PoolConnection, businessId: string, locationId: number) {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` IN ('business_timezone','builds_enabled','build_from_sale_enabled', ?)",
    [businessId, `build_from_sale_location:${locationId}`],
  );
  const values = new Map(rows.map(row => [String(row.key), String(row.value)]));
  const zone = values.get('business_timezone');
  return {
    timeZone: zone && isValidBusinessTimeZone(zone) ? zone : DEFAULT_BUSINESS_TIME_ZONE,
    buildEnabled: isBuildsEnabled(values.get('builds_enabled'))
      && isBuildFromSaleEnabled(values.get('build_from_sale_enabled'), values.get(`build_from_sale_location:${locationId}`)),
  };
}

export function catalogueThumbnail(url: string | null, source: string | null): string | null {
  if (!url) return null;
  if (source !== 'shopify' && source !== 'google_drive') return url;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return url; }
  if (source === 'shopify') parsed.searchParams.set('width', '200');
  else if (parsed.searchParams.has('sz')) parsed.searchParams.set('sz', 'w200');
  return parsed.toString();
}

export async function projectCatalogue(
  connection: PoolConnection, businessId: string, locationId: number, ids: string[],
  today: string, buildEnabled: boolean,
): Promise<CachedProduct[]> {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const buildSql = buildEnabled ? `COALESCE((
    SELECT MIN(GREATEST(0, COALESCE(cs.qty_on_hand,0) - COALESCE(cs.qty_committed,0)) / c.quantity_per_output)
    FROM ims_product_build_recipes r
    JOIN ims_product_build_recipe_components c ON c.recipe_version_id = r.active_version_id
    LEFT JOIN ims_stock cs ON cs.variant_id = c.component_variant_id AND cs.location_id = ?
    WHERE r.business_id = p.business_id AND r.output_variant_id = v.variant_id AND r.is_enabled = 1),0)` : '0';
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT /*+ MAX_EXECUTION_TIME(30000) */ v.*, p.name AS product_name, p.brand,
      COALESCE(s.qty_on_hand,0) AS soh, COALESCE(s.qty_on_hand,0)-COALESCE(s.qty_committed,0) AS available,
      COALESCE(sa.soh_all,0) AS soh_all, COALESCE(sa.available_all,0) AS available_all,
      EXISTS(SELECT 1 FROM ims_product_build_recipes r WHERE r.business_id = p.business_id
        AND r.output_variant_id = v.variant_id AND r.is_enabled = 1) AS has_build_recipe,
      ${buildSql} AS buildable_quantity,
      (SELECT i.url FROM ims_product_images i WHERE i.product_id = p.product_id ORDER BY i.is_primary DESC, i.sort_order, i.id LIMIT 1) AS image_url,
      (SELECT i.source FROM ims_product_images i WHERE i.product_id = p.product_id ORDER BY i.is_primary DESC, i.sort_order, i.id LIMIT 1) AS image_source
    FROM ims_product_variants v JOIN ims_products p ON p.product_id = v.product_id
    LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
    LEFT JOIN (SELECT variant_id, SUM(qty_on_hand) AS soh_all,
      SUM(qty_on_hand - COALESCE(qty_committed,0)) AS available_all FROM ims_stock
      WHERE variant_id IN (${placeholders}) GROUP BY variant_id) sa ON sa.variant_id = v.variant_id
    WHERE p.business_id = ? AND p.is_active = 1 AND v.is_active = 1 AND v.variant_id IN (${placeholders})
    ORDER BY p.name, v.sku`,
    [...(buildEnabled ? [locationId] : []), locationId, ...ids, businessId, ...ids],
  );
  return rows.map(row => {
    const price = row.price_rrp_sale == null ? null : Number(row.price_rrp_sale);
    const discounted = price !== null && price > 0 && row.discount_start_date != null && row.discount_end_date != null
      && today >= String(row.discount_start_date).slice(0, 10) && today <= String(row.discount_end_date).slice(0, 10);
    const options = [row.option1_value, row.option2_value, row.option3_value].filter(Boolean).join(' / ');
    return {
      variant_id: String(row.variant_id), product_id: String(row.product_id),
      name: options ? `${row.product_name} — ${options}` : String(row.product_name),
      code: row.sku ?? null, barcode: row.barcode ?? null, brand: row.brand ?? null,
      price: discounted ? price! : Number(row.price_rrp ?? 0),
      original_price: discounted ? Number(row.price_rrp ?? 0) : null, cost: row.cost_aud == null ? null : Number(row.cost_aud),
      soh: Number(row.soh), soh_all: Number(row.soh_all), available: Number(row.available), available_all: Number(row.available_all),
      has_build_recipe: Boolean(row.has_build_recipe), buildable_quantity: Number(row.buildable_quantity), build_from_sale_enabled: buildEnabled,
      image_url: catalogueThumbnail(row.image_url ?? null, row.image_source ?? null),
    };
  });
}
