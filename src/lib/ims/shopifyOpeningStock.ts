export const SHOPIFY_OPENING_STOCK_LOCATION_NAMES = ['Warehouse', 'Kotara'] as const;

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

function locationKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function resolveOpeningStockLocations(
  shopifyLocations: OpeningStockLocation[],
  solvantisLocations: OpeningStockLocation[],
): Array<{ name: string; shopifyLocationId: number; solvantisLocationId: number }> {
  return SHOPIFY_OPENING_STOCK_LOCATION_NAMES.map(name => {
    const key = locationKey(name);
    const shopifyMatches = shopifyLocations.filter(location => locationKey(location.name) === key && location.active !== false);
    const solvantisMatches = solvantisLocations.filter(location => locationKey(location.name) === key && Number(location.active ?? 1) !== 0);
    if (shopifyMatches.length !== 1) {
      throw new Error(`Expected exactly one active Shopify location named ${name}; found ${shopifyMatches.length}.`);
    }
    if (solvantisMatches.length !== 1) {
      throw new Error(`Expected exactly one active Solvantis location named ${name}; found ${solvantisMatches.length}.`);
    }
    return {
      name,
      shopifyLocationId: Number(shopifyMatches[0].id),
      solvantisLocationId: Number(solvantisMatches[0].id),
    };
  });
}

export function planOpeningStockLines(
  variants: OpeningStockVariant[],
  levels: ShopifyInventoryLevel[],
  locations: Array<{ name: string; shopifyLocationId: number; solvantisLocationId: number }>,
): OpeningStockLine[] {
  const levelByKey = new Map(levels.map(level => [
    `${level.inventoryItemId}:${level.locationId}`,
    Number(level.available ?? 0),
  ]));

  return locations.flatMap(location => variants.map(variant => {
    const available = levelByKey.get(`${variant.inventoryItemId}:${location.shopifyLocationId}`) ?? 0;
    const finiteAvailable = Number.isFinite(available) ? available : 0;
    return {
      ...variant,
      locationName: location.name,
      solvantisLocationId: location.solvantisLocationId,
      quantity: Math.max(0, finiteAvailable),
      wasNegative: finiteAvailable < 0,
    };
  }));
}
