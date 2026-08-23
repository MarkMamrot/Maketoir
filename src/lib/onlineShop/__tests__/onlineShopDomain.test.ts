import { describe, expect, it } from 'vitest';

import { normalizeOnlineShopDomain } from '../onlineShopDomain';

describe('normalizeOnlineShopDomain', () => {
  it('normalizes valid hostnames including international domains', () => {
    expect(normalizeOnlineShopDomain(' Shop.Example.COM. ')).toBe('shop.example.com');
    expect(normalizeOnlineShopDomain('münchen.example')).toBe('xn--mnchen-3ya.example');
  });

  it('rejects URLs, single labels, invalid labels, and platform hosts', () => {
    expect(normalizeOnlineShopDomain('https://shop.example.com')).toBe('');
    expect(normalizeOnlineShopDomain('localhost')).toBe('');
    expect(normalizeOnlineShopDomain('-shop.example.com')).toBe('');
    expect(normalizeOnlineShopDomain('shop.solvantis.com.au')).toBe('');
    expect(normalizeOnlineShopDomain('shop.up.railway.app')).toBe('');
  });
});