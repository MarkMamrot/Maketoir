import { describe, expect, it } from 'vitest';
import { normalizeCogsCostRepairs, parseForeignCostHints } from '../cogsCostRepair';

describe('COGS cost repair', () => {
  it('normalizes valid foreign catalogue costs without treating them as AUD', () => {
    expect(parseForeignCostHints('{"usd":4.5,"THB":120,"AUD":0,"bad":"x"}')).toEqual([
      { currency: 'THB', amount: 120 }, { currency: 'USD', amount: 4.5 },
    ]);
  });

  it('requires positive reviewed costs, unique movements, and a reason', () => {
    expect(normalizeCogsCostRepairs([{ movementId: 7, expectedUnitCost: null, newUnitCost: 4.123456,
      source: 'manual', reason: 'Reviewed supplier invoice', fifoWarningAccepted: true }]))
      .toMatchObject([{ movementId: 7, newUnitCost: 4.1235 }]);
    expect(() => normalizeCogsCostRepairs([{ movementId: 7, newUnitCost: 0, source: 'manual', reason: 'No' }])).toThrow();
  });
});