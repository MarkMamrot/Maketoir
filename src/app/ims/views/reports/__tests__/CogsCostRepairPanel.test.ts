import { describe, expect, it } from 'vitest';
import { fillBlankSelections, type RepairMovement, type Selection } from '../CogsCostRepairPanel';

const movement = (id: number, costAud: number | null, averageCost: number | null): RepairMovement => ({
  id, sku: `SKU-${id}`, productName: `Product ${id}`, locationName: 'Warehouse', movementType: 'pos_sale',
  referenceType: 'pos_sale', referenceId: id, quantity: 1, unitCost: null, costMethod: 'average_cost',
  occurredAt: '2026-07-01T00:00:00.000Z', suggestions: { costAud, averageCost, foreign: [] },
});

describe('COGS bulk cost suggestions', () => {
  it('fills only blank reviewed costs where the selected suggestion is available', () => {
    const existing: Record<number, Selection> = {
      2: { value: '7.25', source: 'manual', detail: { label: 'Reviewed invoice' } },
    };
    const result = fillBlankSelections([
      movement(1, 5, 4.5), movement(2, 6, 5.5), movement(3, null, null),
    ], existing, 'average_cost');

    expect(result[1]).toEqual({ value: '4.5', source: 'average_cost', detail: { label: 'Current average cost', averageCost: 4.5 } });
    expect(result[2]).toEqual(existing[2]);
    expect(result[3]).toBeUndefined();
  });

  it('records Cost AUD provenance without replacing an existing selection', () => {
    const existing: Record<number, Selection> = {
      2: { value: '8', source: 'average_cost', detail: { label: 'Current average cost' } },
    };
    const result = fillBlankSelections([movement(1, 6.12345, 4), movement(2, 7, 5)], existing, 'cost_aud');

    expect(result[1]).toEqual({ value: '6.1235', source: 'cost_aud', detail: { label: 'Current catalogue AUD cost', costAud: 6.12345 } });
    expect(result[2]).toEqual(existing[2]);
  });
});