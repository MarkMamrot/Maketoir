import { describe, expect, it } from 'vitest';
import { isCatalogueProduct, nextCalendarMonth, parseCatalogueResponse, rebuildTarget, REBUILD_JITTER_MS } from '../catalogueProtocol';
import { catalogueThumbnail } from '../catalogueProjection';

describe('catalogue rebuild policy', () => {
  it.each([
    ['2026-01-31T01:30:00Z', '2026-02-28T01:30:00Z'],
    ['2028-01-31T01:30:00Z', '2028-02-29T01:30:00Z'],
    ['2026-12-15T01:30:00Z', '2027-01-15T01:30:00Z'],
    ['2026-09-17T02:30:00Z', '2026-10-17T01:30:00Z'],
    ['2026-03-17T01:30:00Z', '2026-04-17T02:30:00Z'],
  ])('adds a calendar month in business time: %s', (source, expected) => {
    expect(nextCalendarMonth(Date.parse(source), 'Australia/Sydney')).toBe(Date.parse(expected));
  });

  it('preserves milliseconds', () => {
    expect(nextCalendarMonth(Date.parse('2026-01-15T01:30:00.123Z'), 'Australia/Sydney')).toBe(Date.parse('2026-02-15T01:30:00.123Z'));
  });

  it('does not schedule before eligibility', () => {
    expect(rebuildTarget({ now: 99, eligibleAt: 100, random: 0 })).toBeUndefined();
  });

  it.each([0, 0.5, 1])('bounds the delay for RNG %s', random => {
    expect(rebuildTarget({ now: 100, eligibleAt: 100, random })).toBe(100 + random * REBUILD_JITTER_MS);
  });

  it('does not resample an existing or overdue target', () => {
    expect(rebuildTarget({ now: 900, eligibleAt: 100, pendingAt: 200, random: 1 })).toBe(200);
  });

  it('anchors eligibility reached during the opening window without starting before a calendar month', () => {
    expect(rebuildTarget({ now: 100, openedAt: 100, eligibleAt: 200, random: 0 })).toBe(200);
    expect(rebuildTarget({ now: 100, openedAt: 100, eligibleAt: 100 + REBUILD_JITTER_MS + 1, random: 0 })).toBeUndefined();
    expect(rebuildTarget({ now: 100 + REBUILD_JITTER_MS, openedAt: 100, eligibleAt: 200, random: 1 })).toBe(100 + REBUILD_JITTER_MS);
  });

  it.each([-1, 2, NaN])('rejects invalid RNG %s', random => {
    expect(() => rebuildTarget({ now: 100, eligibleAt: 100, random })).toThrow();
  });
});

describe('catalogue wire validation', () => {
  const product = {
    variant_id: 'v', product_id: 'p', name: 'Shirt', code: 'SKU', barcode: null, brand: null,
    price: 20, original_price: null, cost: 10, soh: 1, soh_all: 2, available: 0, available_all: 1, image_url: null,
  };
  const delivery = {
    protocol: 2, mode: 'delta', businessId: 'b', locationId: 1, consumerId: 'consumer', epoch: 'epoch', receipt: 'receipt',
    timeZone: 'Australia/Sydney', serverTime: 100, nextFullAt: 200, products: [product], removed: [], more: false,
  };
  it('accepts complete product records and no field-split protocol', () => {
    expect(isCatalogueProduct(product)).toBe(true);
    expect(parseCatalogueResponse(delivery)).toEqual(delivery);
  });
  it.each([{}, { ...delivery, products: [{}] }, { ...delivery, products: [{ ...product, price: NaN }] },
    { ...delivery, products: [product, product] }, { ...delivery, removed: ['v'] }, { ...delivery, mode: 'other' }])('rejects invalid payload', value => {
    expect(() => parseCatalogueResponse(value)).toThrow();
  });
  it('accepts explicit deferred and disabled states', () => {
    expect(parseCatalogueResponse({ protocol: 2, mode: 'deferred', retryAfterMs: 15_000 }).mode).toBe('deferred');
    expect(parseCatalogueResponse({ protocol: 2, mode: 'disabled', retryAfterMs: 15_000 }).mode).toBe('disabled');
  });
  it('uses primary thumbnail URLs and explicit last-image removal', () => {
    expect(catalogueThumbnail(null, null)).toBeNull();
    expect(catalogueThumbnail('https://cdn.shopify.com/image.png', 'shopify')).toBe('https://cdn.shopify.com/image.png?width=200');
    expect(catalogueThumbnail('https://drive.google.com/image?sz=w800', 'google_drive')).toContain('sz=w200');
  });
});
