import { describe, expect, it } from 'vitest';
import {
  computeLandedCostPerUnit,
  computeMovementCogs,
  computeReceivedUnitCostAud,
  computeWeightedAverageCost,
  normalizeExchangeRate,
  toTaxExclusiveUnitCost,
} from '../avgCostMath';

describe('avgCostMath', () => {
  it('normalizes invalid exchange rates to 1', () => {
    expect(normalizeExchangeRate(undefined)).toBe(1);
    expect(normalizeExchangeRate(null)).toBe(1);
    expect(normalizeExchangeRate(0)).toBe(1);
    expect(normalizeExchangeRate(-2)).toBe(1);
    expect(normalizeExchangeRate(1.25)).toBe(1.25);
  });

  it('converts inclusive tax unit costs to tax-exclusive', () => {
    expect(toTaxExclusiveUnitCost(11, 0.1, 'inc_tax')).toBeCloseTo(10, 10);
    expect(toTaxExclusiveUnitCost(10, 0.1, 'ex_tax')).toBeCloseTo(10, 10);
    expect(toTaxExclusiveUnitCost(10, 0.1, 'no_tax')).toBeCloseTo(10, 10);
  });

  it('distributes landed and freight by value in AUD ex-tax basis', () => {
    const items = [
      { key: 'a', qtyOrdered: 5, unitCost: 11, taxRate: 0.1 },
      { key: 'b', qtyOrdered: 5, unitCost: 22, taxRate: 0.1 },
    ];

    const perUnit = computeLandedCostPerUnit(items, {
      exchangeRate: 2,
      taxTreatment: 'inc_tax',
      totalLandedAud: 30,
      totalFreightAud: 15,
      includeLandedCosts: true,
      includeFreight: true,
    });

    // Item b has double the value contribution of item a, so gets 2x landed/freight per line.
    expect(perUnit.get('a') ?? 0).toBeCloseTo(3, 10);
    expect(perUnit.get('b') ?? 0).toBeCloseTo(6, 10);
  });

  it('supports excluding landed and freight from avg cost', () => {
    const items = [{ key: 'a', qtyOrdered: 10, unitCost: 10, taxRate: 0.1 }];
    const perUnit = computeLandedCostPerUnit(items, {
      exchangeRate: 1,
      taxTreatment: 'ex_tax',
      totalLandedAud: 99,
      totalFreightAud: 99,
      includeLandedCosts: false,
      includeFreight: false,
    });
    expect(perUnit.get('a')).toBe(0);
  });

  it('falls back to equal-per-qty split when subtotal is zero', () => {
    const items = [
      { key: 'a', qtyOrdered: 2, unitCost: 0 },
      { key: 'b', qtyOrdered: 3, unitCost: 0 },
    ];
    const perUnit = computeLandedCostPerUnit(items, {
      taxTreatment: 'ex_tax',
      totalLandedAud: 10,
      includeLandedCosts: true,
      includeFreight: false,
    });
    expect(perUnit.get('a')).toBeCloseTo(2, 10);
    expect(perUnit.get('b')).toBeCloseTo(2, 10);
  });

  it('calculates received unit cost in AUD and tax-exclusive', () => {
    const c = computeReceivedUnitCostAud({
      unitCost: 11,
      taxRate: 0.1,
      taxTreatment: 'inc_tax',
      exchangeRate: 1.5,
      landedCostPerUnitAud: 2,
    });
    // 11 inc GST -> 10 ex GST; FX 1.5 => 15; + landed 2 => 17
    expect(c).toBeCloseTo(17, 10);
  });

  it('computes weighted average on receipt', () => {
    const avg = computeWeightedAverageCost({
      oldQtyOnHand: 10,
      oldAvgCost: 8,
      receivedQty: 5,
      receivedUnitCostAud: 20,
    });
    expect(avg).toBeCloseTo((10 * 8 + 5 * 20) / 15, 10);
  });

  it('uses receipt cost as avg when prior stock is zero', () => {
    const avg = computeWeightedAverageCost({
      oldQtyOnHand: 0,
      oldAvgCost: 99,
      receivedQty: 7,
      receivedUnitCostAud: 12,
    });
    expect(avg).toBe(12);
  });

  it('computes movement COGS as qty * unit cost using absolute qty', () => {
    expect(computeMovementCogs(-3, 4.5)).toBeCloseTo(13.5, 10);
    expect(computeMovementCogs(3, 4.5)).toBeCloseTo(13.5, 10);
  });
});
