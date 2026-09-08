import { describe, expect, it } from 'vitest';

import { validateCarrierAccountInput, validatePackagePresetInput } from '../shippingSettings';

describe('shipping settings validation', () => {
  it('requires eParcel account details and credentials for a new account', () => {
    expect(validateCarrierAccountInput({
      provider: 'auspost_eparcel', displayName: 'Australia Post', environment: 'test', accountNumber: '123',
    })).toEqual([
      'Enter the HTTPS testbed URL supplied by Australia Post.',
      'eParcel account number must contain 10 digits.',
      'eParcel API key and password are required.',
    ]);
  });

  it('allows an eParcel account update to preserve stored credentials', () => {
    expect(validateCarrierAccountInput({
      id: 4, provider: 'auspost_eparcel', displayName: 'Warehouse eParcel', environment: 'production',
      accountNumber: '1234567890', dispatchLocationId: 2,
    }, true)).toEqual([]);
  });

  it('keeps MyPost Business disabled until partner access exists', () => {
    expect(validateCarrierAccountInput({
      provider: 'mypost_business', displayName: 'MyPost Business', environment: 'test', isActive: true,
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