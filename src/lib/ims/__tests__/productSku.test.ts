import { describe, expect, it } from 'vitest';
import { generateProductSku } from '../productSku';

const timestamp = new Date(2026, 7, 31, 14, 5, 9);

describe('generateProductSku', () => {
  it('uses the first three brand letters and a local timestamp', () => {
    expect(generateProductSku('Monster Threads', timestamp)).toBe('MON-260831-140509');
  });

  it('ignores non-letter brand characters', () => {
    expect(generateProductSku('A&B Co.', timestamp)).toBe('ABC-260831-140509');
  });

  it('uses SOL when a brand has no letters', () => {
    expect(generateProductSku('', timestamp)).toBe('SOL-260831-140509');
    expect(generateProductSku('123', timestamp)).toBe('SOL-260831-140509');
  });
});