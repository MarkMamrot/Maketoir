import { describe, expect, it } from 'vitest';
import { isValidWholesaleUnitQuantity, wholesaleEntryQuantityToUnits, wholesalePackSize, wholesaleUnitsToEntryQuantity } from '../wholesaleOrderQuantity';

describe('wholesale order quantities', () => {
  it('converts entered packs to unit quantities', () => {
    expect(wholesaleEntryQuantityToUnits(3, 6, 'pack')).toBe(18);
    expect(wholesaleUnitsToEntryQuantity(18, 6, 'pack')).toBe(3);
  });

  it('preserves individual quantities and treats missing pack sizes as singles', () => {
    expect(wholesaleEntryQuantityToUnits(3, 6, 'individual')).toBe(3);
    expect(wholesalePackSize(null)).toBe(1);
    expect(wholesaleEntryQuantityToUnits(3, null, 'pack')).toBe(3);
  });

  it('validates stored unit quantities against pack multiples', () => {
    expect(isValidWholesaleUnitQuantity(18, 6, 'pack')).toBe(true);
    expect(isValidWholesaleUnitQuantity(17, 6, 'pack')).toBe(false);
    expect(isValidWholesaleUnitQuantity(17, 6, 'individual')).toBe(true);
  });
});