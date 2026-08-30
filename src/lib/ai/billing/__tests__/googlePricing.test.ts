import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('googleapis', () => ({ google: { auth: { GoogleAuth: class { getClient() { return Promise.resolve({ getRequestHeaders: () => Promise.resolve({ Authorization: 'Bearer test' }) }); } } } } }));

import { buildGoogleRatePreview, fetchGoogleRatePreview } from '../googlePricing';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.unstubAllGlobals();
});

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

  it('requires a configured billing account before authentication', async () => {
    delete process.env.GOOGLE_CLOUD_BILLING_ACCOUNT_ID;
    delete process.env.GOOGLE_BILLING_ACCOUNT_ID;
    await expect(fetchGoogleRatePreview()).rejects.toThrow('GOOGLE_CLOUD_BILLING_ACCOUNT_ID');
  });

  it('rejects malformed inline credentials with an actionable error', async () => {
    process.env.GOOGLE_CLOUD_BILLING_ACCOUNT_ID = 'ABC-123';
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = '{bad';
    delete process.env.GOOGLE_CLIENT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
    await expect(fetchGoogleRatePreview()).rejects.toThrow('not valid JSON');
  });

  it('follows pagination and uses the Gemini API service filter', async () => {
    process.env.GOOGLE_CLOUD_BILLING_ACCOUNT_ID = 'billingAccounts/ABC-123';
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const fetchMock = vi.fn(async (request: string) => {
      const url = String(request);
      if (url.includes('/services') && !url.includes('pageToken=')) return Response.json({ billingAccountServices: [], nextPageToken: 'next' });
      if (url.includes('/services')) return Response.json({ billingAccountServices: [{ name: 'billingAccounts/ABC-123/services/gemini', displayName: 'Gemini API' }] });
      if (url.includes('/skus?')) return Response.json({ billingAccountSkus: [{ skuId: 'SKU-4', displayName: 'Gemini 2.5 Flash Input Tokens' }] });
      return Response.json({ billingAccountPrices: [{ name: 'billingAccounts/ABC-123/skus/SKU-4/price', currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'AUD', units: '1' } }], unitInfo: { unitQuantity: { value: '1000000' } } } }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const preview = await fetchGoogleRatePreview();
    expect(preview.candidates[0]).toEqual(expect.objectContaining({ id: 'SKU-4:input_tokens' }));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const skuRequest = fetchMock.mock.calls.find(([url]) => String(url).includes('/skus?'));
    expect(new URL(String(skuRequest?.[0])).searchParams.get('filter')).toBe('billing_account_service = "billingAccounts/ABC-123/services/gemini"');
  });
});