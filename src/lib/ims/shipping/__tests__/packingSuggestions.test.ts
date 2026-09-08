import { describe, expect, it } from 'vitest';

import { suggestParcels, type PackingPreset } from '../packingSuggestions';

const box: PackingPreset = {
  id: 1, name: 'Small box', packageType: 'box', lengthMm: 300, widthMm: 200, heightMm: 100,
  tareWeightKg: 0.2, maxWeightKg: 2, allowRotation: true,
};

describe('suggestParcels', () => {
  it('packs units into the smallest available parcel until its weight is reached', () => {
    const result = suggestParcels([
      { soItemId: 1, reference: 'A', quantity: 1, weightKg: 0.8, lengthMm: 100, widthMm: 100, heightMm: 100 },
      { soItemId: 2, reference: 'B', quantity: 1, weightKg: 0.8, lengthMm: 100, widthMm: 100, heightMm: 100 },
      { soItemId: 3, reference: 'C', quantity: 1, weightKg: 0.8, lengthMm: 100, widthMm: 100, heightMm: 100 },
    ], [box]);
    expect(result.parcels).toHaveLength(2);
    expect(result.parcels[0].units).toHaveLength(2);
    expect(result.unpacked).toEqual([]);
  });

  it('supports rotation and reports units without complete physical data', () => {
    const result = suggestParcels([
      { soItemId: 1, reference: 'rotated', quantity: 1, weightKg: 1, lengthMm: 100, widthMm: 300, heightMm: 200 },
      { soItemId: 2, reference: 'missing', quantity: 1, weightKg: 1, lengthMm: 0, widthMm: 20, heightMm: 20 },
    ], [box]);
    expect(result.parcels[0].units[0].reference).toBe('rotated');
    expect(result.unpacked.map(unit => unit.reference)).toEqual(['missing']);
  });
});