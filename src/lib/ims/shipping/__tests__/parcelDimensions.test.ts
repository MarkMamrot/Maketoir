import { describe, expect, it } from 'vitest';

import { centimetreInputToMillimetres, millimetresToCentimetreInput } from '../parcelDimensions';

describe('parcel dimensions', () => {
  it('displays stored millimetres as centimetres without losing decimal precision', () => {
    expect(millimetresToCentimetreInput(205)).toBe('20.5');
    expect(millimetresToCentimetreInput(77)).toBe('7.7');
  });

  it('converts centimetre input back to the existing millimetre contract', () => {
    expect(centimetreInputToMillimetres('20.5')).toBe(205);
    expect(centimetreInputToMillimetres('7.7')).toBe(77);
  });
});