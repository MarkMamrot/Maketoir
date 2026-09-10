import { describe, expect, it } from 'vitest';
import { normalizeProductCustomsFields } from '../productCustoms';

describe('normalizeProductCustomsFields', () => {
  it('normalizes supported customs values', () => {
    expect(normalizeProductCustomsFields({
      customs_description: '  Cotton shirt  ',
      hs_code: ' 610510 ',
      country_of_origin: 'au',
      is_dangerous_or_restricted: true,
    })).toEqual({
      values: {
        customs_description: 'Cotton shirt',
        hs_code: '610510',
        country_of_origin: 'AU',
        is_dangerous_or_restricted: 1,
      },
      errors: [],
    });
  });

  it('preserves omission so partial updates do not clear stored customs data', () => {
    expect(normalizeProductCustomsFields({ name: 'Harbour Shirt' })).toEqual({ values: {}, errors: [] });
  });

  it('rejects values that cannot fit the schema contract', () => {
    const result = normalizeProductCustomsFields({
      customs_description: 'x'.repeat(251),
      hs_code: '1'.repeat(15),
      country_of_origin: 'Australia',
      is_dangerous_or_restricted: 'yes',
    });

    expect(result.errors.map(error => error.field)).toEqual([
      'customs_description',
      'hs_code',
      'country_of_origin',
      'is_dangerous_or_restricted',
    ]);
    expect(result.values).toEqual({});
  });
});