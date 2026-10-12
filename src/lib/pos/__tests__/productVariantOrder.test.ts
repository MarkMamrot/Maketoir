import { describe, expect, it } from 'vitest';
import { compareProductVariants } from '../productVariantOrder';

describe('POS variant ordering', () => {
  it('orders clothing sizes smallest first with colours and aliases', () => {
    const variants = ['XL', 'M', '2XL', 'XS', 'L', 'S', 'XXS'].map(size => ({ name: `Shirt — Blue / ${size}` }));
    expect(variants.sort(compareProductVariants).map(variant => variant.name.split(' / ')[1])).toEqual(['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL']);
  });
  it('uses natural order for numeric sizes without mutating input', () => {
    const variants = ['12', '8', '10'].map(size => ({ name: `Shirt — ${size}` }));
    expect([...variants].sort(compareProductVariants).map(variant => variant.name)).toEqual(['Shirt — 8', 'Shirt — 10', 'Shirt — 12']);
    expect(variants[0].name).toBe('Shirt — 12');
  });
});