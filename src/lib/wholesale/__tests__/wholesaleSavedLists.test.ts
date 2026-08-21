import { describe, expect, it } from 'vitest';
import {
  normalizeWholesaleSavedListItems,
  normalizeWholesaleSavedListName,
  WholesaleSavedListValidationError,
} from '../wholesaleSavedLists';

describe('wholesale saved list inputs', () => {
  it('normalizes a bounded display name', () => {
    expect(normalizeWholesaleSavedListName('  Winter   core range  ')).toBe('Winter core range');
  });

  it('retains only stable variant IDs and whole desired quantities', () => {
    expect(normalizeWholesaleSavedListItems([
      { variantId: 'variant-1', quantity: 3, unitPrice: 12.5 },
    ])).toEqual([{ variantId: 'variant-1', quantity: 3 }]);
  });

  it.each([
    [[{ variantId: 'variant-1', quantity: 1.5 }], 'whole numbers'],
    [[{ variantId: 'variant-1', quantity: 1 }, { variantId: 'variant-1', quantity: 2 }], 'only once'],
    [Array.from({ length: 251 }, (_, index) => ({ variantId: `variant-${index}`, quantity: 1 })), 'up to 250'],
  ])('rejects unsafe list items', (items, message) => {
    expect(() => normalizeWholesaleSavedListItems(items)).toThrow(message);
  });

  it('uses a domain validation error', () => {
    expect(() => normalizeWholesaleSavedListName('')).toThrow(WholesaleSavedListValidationError);
  });
});