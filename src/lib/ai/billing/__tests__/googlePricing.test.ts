import { describe, expect, it } from 'vitest';
import { buildGoogleRatePreview } from '../googlePricing';

describe('Google pricing preview', () => {
  it('maps one standard contract token rate and duplicates output for thinking', () => {
    const preview = buildGoogleRatePreview(
      [{ skuId: 'SKU-1', displayName: 'Gemini 2.5 Flash Output Tokens' }],
      [{ name: 'billingAccounts/a/skus/SKU-1/price', currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, listPrice: { currencyCode: 'AUD', units: '4' }, contractPrice: { currencyCode: 'AUD', units: '3', nanos: 750000000 } }], unitInfo: { unitQuantity: { value: '1000000' } } } }],
      '2026-08-30T00:00:00.000Z',
    );
    expect(preview.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'SKU-1:output_tokens', modelId: 'gemini-2.5-flash', priceAud: '3.75', unitScale: 1_000_000 }),
      expect.objectContaining({ id: 'SKU-1:thinking_tokens', modelId: 'gemini-2.5-flash', priceAud: '3.75' }),
    ]));
  });

  it('refuses threshold and multi-tier prices', () => {
    const preview = buildGoogleRatePreview(
      [{ skuId: 'SKU-2', displayName: 'Gemini 2.5 Pro Input Tokens up to 200000' }],
      [{ name: 'billingAccounts/a/skus/SKU-2/price', currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'AUD', units: '1' } }, { startAmount: { value: '200000' }, contractPrice: { currencyCode: 'AUD', units: '2' } }], unitInfo: { unitQuantity: { value: '1000000' } } } }],
    );
    expect(preview.candidates).toHaveLength(0);
    expect(preview.warnings[0]?.reason).toContain('Unsupported');
  });

  it('does not label a non-AUD response as AUD', () => {
    const preview = buildGoogleRatePreview(
      [{ skuId: 'SKU-3', displayName: 'Gemini 2.5 Flash Input Tokens' }],
      [{ name: 'billingAccounts/a/skus/SKU-3/price', currencyCode: 'USD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'USD', units: '1' } }], unitInfo: { unitQuantity: { value: '1000000' } } } }],
    );
    expect(preview.candidates).toHaveLength(0);
    expect(preview.warnings[0]?.reason).toContain('AUD');
  });
});