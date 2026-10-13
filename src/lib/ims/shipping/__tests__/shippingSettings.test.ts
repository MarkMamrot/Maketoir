import { describe, expect, it } from 'vitest';

import { buildDimensionPresetInput, validateCarrierAccountInput, validatePackagePresetInput } from '../shippingSettings';

describe('shipping settings validation', () => {
  it('creates a reusable dimensions-only preset in millimetres, without copying packed weight or overwriting a preset', () => {
    const preset = buildDimensionPresetInput('  Regular parcel  ', {
      lengthCm: '25.25', widthCm: '16', heightCm: '8.05',
    });
    expect(preset).toEqual({
      name: 'Regular parcel', packageType: 'custom', lengthMm: 252.5, widthMm: 160, heightMm: 80.5,
      tareWeightKg: 0, maxWeightKg: null, allowRotation: true, isActive: true,
    });
    expect(validatePackagePresetInput(preset)).toEqual([]);
    expect(preset).not.toHaveProperty('id');
    expect(preset).not.toHaveProperty('weightKg');
  });

  it.each(['', '0', '-1', 'abc', '1000.1'])('rejects invalid saved dimension %s', lengthCm => {
    const preset = buildDimensionPresetInput('Parcel', { lengthCm, widthCm: '16', heightCm: '8' });
    expect(validatePackagePresetInput(preset)).toContain('Length must be greater than 0 and no more than 10,000 mm.');
  });

  it('accepts the exact preset dimension limit and rejects blank or oversized names', () => {
    const dimensions = { lengthCm: '1000', widthCm: '1000', heightCm: '1000' };
    expect(validatePackagePresetInput(buildDimensionPresetInput('Large parcel', dimensions))).toEqual([]);
    for (const name of ['   ', 'x'.repeat(121)]) {
      expect(validatePackagePresetInput(buildDimensionPresetInput(name, dimensions)))
        .toContain('Package name is required and must be 120 characters or fewer.');
    }
  });

  it('requires eParcel account details and credentials for a new account', () => {
    expect(validateCarrierAccountInput({
      provider: 'auspost_eparcel', displayName: 'Australia Post', accountNumber: '123',
    })).toEqual([
      'eParcel account number must contain 10 digits.',
      'eParcel API key and password are required.',
    ]);
  });

  it('allows an eParcel account update to preserve stored credentials', () => {
    expect(validateCarrierAccountInput({
      id: 4, provider: 'auspost_eparcel', displayName: 'Warehouse eParcel',
      accountNumber: '1234567890', dispatchLocationId: 2,
    }, true)).toEqual([]);
  });

  it('keeps MyPost Business disabled until partner access exists', () => {
    expect(validateCarrierAccountInput({
      provider: 'mypost_business', displayName: 'MyPost Business', isActive: true,
    })).toContain('MyPost Business requires Australia Post partner access before it can be enabled.');
  });

  it('validates physical package limits', () => {
    expect(validatePackagePresetInput({
      name: 'Small box', packageType: 'box', lengthMm: 220, widthMm: 160, heightMm: 80,
      tareWeightKg: 0.15, maxWeightKg: 5, allowRotation: true,
    })).toEqual([]);
    expect(validatePackagePresetInput({
      name: '', packageType: 'box', lengthMm: 0, widthMm: 160, heightMm: 80,
      tareWeightKg: -1, maxWeightKg: 0, allowRotation: true,
    })).toHaveLength(4);
  });
});