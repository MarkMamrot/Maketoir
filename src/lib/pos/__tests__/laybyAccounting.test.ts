import { describe, expect, it } from 'vitest';
import { planLaybyJournal, splitLaybyEod } from '../laybyAccounting';

describe('layby accounting', () => {
  it('separates receipts from ordinary EOD revenue without changing the counted total', () => {
    expect(splitLaybyEod(136, 26)).toEqual({ revenue: 110, liability: 26, total: 136 });
    expect(splitLaybyEod(26, 26)).toEqual({ revenue: 0, liability: 26, total: 26 });
  });
  it('keeps cancellation refunds separate from ordinary revenue', () => {
    expect(splitLaybyEod(84, -26)).toEqual({ revenue: 110, liability: -26, total: 84 });
  });
  it('attributes GST on final payment without recognising revenue', () => {
    expect(planLaybyJournal('gst', 129.95)).toEqual([
      { role: 'liability', amount: 129.95, taxType: 'NONE' },
      { role: 'liability', amount: -129.95, taxType: 'OUTPUT' },
    ]);
  });
  it('releases only the GST-exclusive liability as revenue on collection', () => {
    expect(planLaybyJournal('collection', 118.14)).toEqual([
      { role: 'liability', amount: 118.14, taxType: 'NONE' },
      { role: 'revenue', amount: -118.14, taxType: 'NONE' },
    ]);
  });
  it('reverses full-payment GST when a paid layby is cancelled', () => {
    expect(planLaybyJournal('gst_reversal', 129.95)[1]).toMatchObject({ amount: 129.95, taxType: 'OUTPUT' });
    expect(planLaybyJournal('cancellation_fee', 20)[1]).toMatchObject({ amount: -20, taxType: 'OUTPUT' });
  });
});