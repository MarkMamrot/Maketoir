export const SHOPIFY_INVENTORY_CONFIRMATION = 'REPLACE SOLVANTIS STOCK';

export class ShopifyOpeningStockValidationError extends Error {}

export interface OpeningStockMapping {
  shopifyLocationId: number;
  solvantisLocationId: number;
}

export interface OpeningStockLocation {
  id: number;
  name: string;
  active?: boolean | number;
}

export interface OpeningStockVariant {
  variantId: string;
  inventoryItemId: string;
  sku?: string | null;
  productName?: string | null;
}

export interface ShopifyInventoryLevel {
  inventoryItemId: string;
  locationId: string;
  available: number | null;
}

export interface OpeningStockLine {
  variantId: string;
  inventoryItemId: string;
  locationName: string;
  solvantisLocationId: number;
  quantity: number;
  wasNegative: boolean;
  sku?: string | null;
  productName?: string | null;
}

export function changedOpeningStockVariantIds(
  lines: Array<{ variantId: string; adjustment: number }>,
): Set<string> {
  return new Set(lines
    .filter(line => Number.isFinite(line.adjustment) && Math.abs(line.adjustment) > 0.0001)
    .map(line => line.variantId));
}

export function resolveOpeningStockLocations(
  shopifyLocations: OpeningStockLocation[],
  solvantisLocations: OpeningStockLocation[],
  mappings: OpeningStockMapping[],
): Array<{ name: string; shopifyLocationId: number; solvantisLocationId: number }> {
  if (!Array.isArray(mappings) || !mappings.length || mappings.length > 20) {
    throw new ShopifyOpeningStockValidationError('Select between 1 and 20 location mappings.');
  }
  const sources = new Set<number>();
  const targets = new Set<number>();
  return mappings.map(mapping => {
    if (!mapping || !Number.isSafeInteger(mapping.shopifyLocationId) || !Number.isSafeInteger(mapping.solvantisLocationId)
      || mapping.shopifyLocationId <= 0 || mapping.solvantisLocationId <= 0
      || sources.has(mapping.shopifyLocationId) || targets.has(mapping.solvantisLocationId)) {
      throw new ShopifyOpeningStockValidationError('Each active Shopify and Solvantis location can be mapped only once.');
    }
    const source = shopifyLocations.find(location => Number(location.id) === mapping.shopifyLocationId && Number(location.active ?? 1) !== 0);
    const target = solvantisLocations.find(location => Number(location.id) === mapping.solvantisLocationId && Number(location.active ?? 1) !== 0);
    if (!source || !target) throw new ShopifyOpeningStockValidationError('A selected location is missing or inactive. Reload locations.');
    sources.add(mapping.shopifyLocationId);
    targets.add(mapping.solvantisLocationId);
    return {
      name: target.name,
      shopifyLocationId: mapping.shopifyLocationId,
      solvantisLocationId: mapping.solvantisLocationId,
    };
  });
}

export function planOpeningStockLines(
  variants: OpeningStockVariant[],
  levels: ShopifyInventoryLevel[],
  locations: Array<{ name: string; shopifyLocationId: number; solvantisLocationId: number }>,
): OpeningStockLine[] {
  const levelByKey = new Map<string, number>();
  for (const level of levels) {
    if (level.available === null || !Number.isFinite(level.available)) continue;
    const key = `${level.inventoryItemId}:${level.locationId}`;
    if (levelByKey.has(key)) throw new Error('Shopify returned duplicate inventory levels. Preview again.');
    levelByKey.set(key, level.available);
  }

  return locations.flatMap(location => variants.flatMap(variant => {
    const available = levelByKey.get(`${variant.inventoryItemId}:${location.shopifyLocationId}`);
    if (available === undefined) return [];
    return [{
      ...variant,
      locationName: location.name,
      solvantisLocationId: location.solvantisLocationId,
      quantity: Math.max(0, available),
      wasNegative: available < 0,
    }];
  }));
}
