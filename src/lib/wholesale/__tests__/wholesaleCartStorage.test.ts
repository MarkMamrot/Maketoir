import { describe, expect, it } from 'vitest';
import { getWholesaleCartStorageKey, LEGACY_WHOLESALE_CART_KEY } from '../wholesaleCartStorage';

const identity = {
  supplierSlug: 'MonsterThreads', businessId: 'business-1', contactId: 10,
  companyId: 20, locationId: 30, memberId: 40,
};

describe('wholesale cart storage identity', () => {
  it('scopes carts to supplier and the full account tuple without personal data', () => {
    const key = getWholesaleCartStorageKey(identity);

    expect(key).toBe('wholesale_cart%3Av2:monsterthreads:business-1:10:20:30:40');
    expect(key).not.toContain('@');
  });

  it.each([
    ['supplier', { ...identity, supplierSlug: '' }],
    ['business', { ...identity, businessId: '' }],
    ['company', { ...identity, companyId: undefined }],
    ['location', { ...identity, locationId: undefined }],
    ['member', { ...identity, memberId: undefined }],
  ])('fails closed when %s identity is missing', (_label, value) => {
    expect(getWholesaleCartStorageKey(value)).toBeNull();
  });

  it('keeps the unsafe legacy key explicit for removal only', () => {
    expect(LEGACY_WHOLESALE_CART_KEY).toBe('wholesale_cart');
  });
});