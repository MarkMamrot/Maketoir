import type { StorefrontShippingAddress } from '@/lib/storefront/shipping';

export interface OnlineShopShippingRule {
  id: number;
  name: string;
  ruleType: 'flat';
  amountCents: number;
  freeOverCents: number | null;
  states: string[];
  postcodes: string[];
  sortOrder: number;
}

export interface OnlineShopShippingQuote {
  ruleId: number;
  label: string;
  amountCents: number;
}

const AU_STATES = new Set(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']);

export function normalizeAustralianShippingAddress(input: unknown): StorefrontShippingAddress {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const address = String(value.address ?? '').trim();
  const address2 = String(value.address2 ?? '').trim();
  const suburb = String(value.suburb ?? '').trim();
  const city = String(value.city ?? '').trim();
  const state = String(value.state ?? '').trim().toUpperCase();
  const postcode = String(value.postcode ?? '').trim();
  const country = String(value.country ?? 'Australia').trim();
  if (!address || !suburb || !AU_STATES.has(state) || !/^\d{4}$/.test(postcode)) {
    throw new Error('Enter a complete Australian delivery address.');
  }
  if (!/^australia$/i.test(country) && country.toUpperCase() !== 'AU') throw new Error('Delivery is currently available within Australia only.');
  return { address: address.slice(0, 255), ...(address2 ? { address2: address2.slice(0, 255) } : {}),
    suburb: suburb.slice(0, 100), ...(city ? { city: city.slice(0, 100) } : {}), state, postcode, country: 'Australia' };
}

function postcodeMatches(postcode: string, patterns: readonly string[]): boolean {
  if (!patterns.length) return true;
  return patterns.some(rawPattern => {
    const pattern = rawPattern.trim();
    if (/^\d{4}$/.test(pattern)) return postcode === pattern;
    if (/^\d{1,3}\*$/.test(pattern)) return postcode.startsWith(pattern.slice(0, -1));
    if (/^\d{4}-\d{4}$/.test(pattern)) {
      const [from, to] = pattern.split('-').map(Number);
      const value = Number(postcode);
      return value >= from && value <= to;
    }
    return false;
  });
}

export function quoteOnlineShopShipping(input: {
  address: StorefrontShippingAddress;
  subtotalCents: number;
  rules: readonly OnlineShopShippingRule[];
}): OnlineShopShippingQuote[] {
  if (!Number.isSafeInteger(input.subtotalCents) || input.subtotalCents < 0) throw new Error('Shipping subtotal must be valid cents.');
  return [...input.rules].sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id).filter(rule => {
    if (rule.ruleType !== 'flat') return false;
    if (rule.states.length && !rule.states.includes(input.address.state.toUpperCase())) return false;
    return postcodeMatches(input.address.postcode, rule.postcodes);
  }).map(rule => ({ ruleId: rule.id, label: rule.name,
    amountCents: rule.freeOverCents !== null && input.subtotalCents >= rule.freeOverCents ? 0 : rule.amountCents }));
}