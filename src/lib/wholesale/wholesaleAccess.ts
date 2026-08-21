export const SELLS_WHOLESALE_SETTING_KEY = 'sells_wholesale';

export type WholesaleBrandAccess =
  | { mode: 'all'; brands: string[] }
  | { mode: 'none'; brands: string[] }
  | { mode: 'selected'; brands: string[] };

export function isWholesaleEnabled(value: unknown): boolean {
  return String(value ?? 'yes').trim().toLowerCase() !== 'no';
}

export function normalizeWholesaleBrands(value: unknown): string[] | null {
  if (value == null || value === '') return null;

  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new TypeError('Wholesale brand access must be a valid JSON array.');
    }
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError('Wholesale brand access must be an array.');
  }

  const brands: string[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== 'string') {
      throw new TypeError('Wholesale brand access entries must be brand names.');
    }
    const brand = entry.trim();
    if (!brand) continue;
    if (brand.length > 255) {
      throw new TypeError('Wholesale brand names must be 255 characters or fewer.');
    }
    const key = brand.toLocaleLowerCase('en-AU');
    if (seen.has(key)) continue;
    seen.add(key);
    brands.push(brand);
  }
  return brands;
}

export function parseWholesaleBrandAccess(value: unknown): WholesaleBrandAccess {
  const brands = normalizeWholesaleBrands(value);
  if (brands === null) return { mode: 'all', brands: [] };
  if (brands.length === 0) return { mode: 'none', brands: [] };
  return { mode: 'selected', brands };
}

export function isWholesaleBrandAllowed(access: WholesaleBrandAccess, brand: unknown): boolean {
  if (access.mode === 'all') return true;
  if (access.mode === 'none') return false;
  const candidate = typeof brand === 'string' ? brand.trim().toLocaleLowerCase('en-AU') : '';
  if (!candidate) return false;
  return access.brands.some(allowed => allowed.toLocaleLowerCase('en-AU') === candidate);
}

export function isWholesaleContactEligible(type: unknown, priceTier: unknown, isActive: unknown = 1): boolean {
  return Number(isActive) === 1
    && (type === 'b2b_customer' || type === 'both')
    && String(priceTier ?? '').trim().toLowerCase() === 'wholesale';
}
