import { describe, expect, it } from 'vitest';
import { deriveVariantSku } from '../importSku';

describe('deriveVariantSku', () => {
  it('uses Product SKU for a default or single variant', () => {
    expect(deriveVariantSku(' MT-RCAK ', [])).toBe('MT-RCAK');
    expect(deriveVariantSku('MT-RCAK', ['Default'])).toBe('MT-RCAK');
  });

  it('appends non-default option values in option order', () => {
    expect(deriveVariantSku('MT-RCAK', ['Large', 'Ocean Blue', ''])).toBe('MT-RCAK-Large-OceanBlue');
  });

  it('requires a Product SKU', () => {
    expect(deriveVariantSku('', ['Large'])).toBe('');
  });
});