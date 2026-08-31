import { describe, expect, it } from 'vitest';
import { isInStockAtLocation } from '../_productFilters';

describe('POS in-stock product filter', () => {
  it('only includes products available to sell at the current location', () => {
    expect(isInStockAtLocation({ soh: 2, available: 1 })).toBe(true);
    expect(isInStockAtLocation({ soh: 0, available: 0 })).toBe(false);
    expect(isInStockAtLocation({ soh: -1, available: -1 })).toBe(false);
    expect(isInStockAtLocation({ soh: 2, available: 0 })).toBe(false);
  });

  it('falls back to stock on hand when availability is absent', () => {
    expect(isInStockAtLocation({ soh: 1 })).toBe(true);
    expect(isInStockAtLocation({ soh: 0 })).toBe(false);
  });
});