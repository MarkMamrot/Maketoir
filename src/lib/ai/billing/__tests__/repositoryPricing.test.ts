import { describe, expect, it } from 'vitest';
import { deriveMarkupRates } from '../repository';

describe('dynamic AI plan pricing', () => {
  it('derives sell rates from provider micros and rounds upward', () => {
    const rates = deriveMarkupRates([
      { metric: 'input_tokens', price_per_unit_micros: '1000001', unit_scale: 1_000_000 } as any,
    ], 2750);
    expect(rates[0].price_per_unit_micros).toBe('1275002');
  });

  it('does not mutate provider rate snapshots', () => {
    const provider = [{ metric: 'output_tokens', price_per_unit_micros: '2000000', unit_scale: 1_000_000 }] as any;
    deriveMarkupRates(provider, 1000);
    expect(provider[0].price_per_unit_micros).toBe('2000000');
  });
});