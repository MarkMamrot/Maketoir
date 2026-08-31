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

  it('preserves preview model identities', () => {
    const preview = buildGoogleRatePreview(
      [{ skuId: 'SKU-PRO', displayName: 'Gemini 3.1 Pro Preview Input Tokens' }],
      [{ name: 'billingAccounts/a/skus/SKU-PRO/price', currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'AUD', units: '2' } }], unitInfo: { unitQuantity: { value: '1000000' } } } }],
    );
    expect(preview.candidates).toEqual([
      expect.objectContaining({ modelId: 'gemini-3.1-pro-preview', metric: 'input_tokens' }),
    ]);
  });

  it('maps standard and over-200k Pro price tiers', () => {
    const preview = buildGoogleRatePreview(
      [{ skuId: 'SKU-2', displayName: 'Gemini 2.5 Pro Input Tokens' }],
      [{ name: 'billingAccounts/a/skus/SKU-2/price', currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'AUD', units: '1' } }, { startAmount: { value: '200000' }, contractPrice: { currencyCode: 'AUD', units: '2' } }], unitInfo: { unitQuantity: { value: '1000000' } } } }],
    );
    expect(preview.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'gemini-2.5-pro', metric: 'input_tokens', priceAud: '1' }),
      expect.objectContaining({ modelId: 'gemini-2.5-pro', metric: 'input_tokens_over_200k', priceAud: '2' }),
    ]));
  });

  it('maps a separately labelled over-200k Pro SKU', () => {
    const preview = buildGoogleRatePreview(
      [{ skuId: 'SKU-PRO-LONG', displayName: 'Gemini 3.1 Pro Preview Output Tokens over 200K' }],
      [{ name: 'billingAccounts/a/skus/SKU-PRO-LONG/price', currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'AUD', units: '18' } }], unitInfo: { unitQuantity: { value: '1000000' } } } }],
    );
    expect(preview.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'gemini-3.1-pro-preview', metric: 'output_tokens_over_200k', priceAud: '18' }),
      expect.objectContaining({ modelId: 'gemini-3.1-pro-preview', metric: 'thinking_tokens_over_200k', priceAud: '18' }),
    ]));
  });

  it('maps Google short and long Pro SKU labels to separate context bands', () => {
    const preview = buildGoogleRatePreview(
      [
        { skuId: 'SKU-SHORT', displayName: 'Generate content input token count Gemini 2.5 Pro short input text' },
        { skuId: 'SKU-LONG', displayName: 'Generate content input token count Gemini 2.5 Pro long input text' },
      ],
      [
        { name: 'billingAccounts/a/skus/SKU-SHORT/price', currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'AUD', units: '2' } }], unitInfo: { unitQuantity: { value: '1000000' } } } },
        { name: 'billingAccounts/a/skus/SKU-LONG/price', currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'AUD', units: '4' } }], unitInfo: { unitQuantity: { value: '1000000' } } } },
      ],
    );
    expect(preview.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'SKU-SHORT:input_tokens', metric: 'input_tokens', priceAud: '2' }),
      expect.objectContaining({ id: 'SKU-LONG:input_tokens_over_200k', metric: 'input_tokens_over_200k', priceAud: '4' }),
    ]));
  });

  it('excludes experimental, TTS, and input-modality Pro SKUs', () => {
    const names = [
      'Generate content input token count Gemini 2.5 Pro Experimental short input text',
      'GenerateContent text input token count for Gemini 2.5 Pro TTS',
      'Generate content input token count Gemini 2.5 Pro input image',
    ];
    const preview = buildGoogleRatePreview(
      names.map((displayName, index) => ({ skuId: `SKU-${index}`, displayName })),
      names.map((_, index) => ({ name: `billingAccounts/a/skus/SKU-${index}/price`, currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'AUD', units: '2' } }], unitInfo: { unitQuantity: { value: '1000000' } } } })),
    );
    expect(preview.candidates).toHaveLength(0);
    expect(preview.warnings).toHaveLength(3);
  });

  it('continues to reject unsupported arbitrary tier boundaries', () => {
    const preview = buildGoogleRatePreview(
      [{ skuId: 'SKU-TIERS', displayName: 'Gemini 2.5 Pro Input Tokens' }],
      [{ name: 'billingAccounts/a/skus/SKU-TIERS/price', currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'AUD', units: '1' } }, { startAmount: { value: '100000' }, contractPrice: { currencyCode: 'AUD', units: '2' } }], unitInfo: { unitQuantity: { value: '1000000' } } } }],
    );
    expect(preview.candidates).toHaveLength(0);
    expect(preview.warnings[0]?.reason).toContain('cannot be represented safely');
  });

  it('maps Nano Banana image output token pricing', () => {
    const preview = buildGoogleRatePreview(
      [{ skuId: 'SKU-IMAGE', displayName: 'Gemini 3.1 Flash Image Output Tokens' }],
      [{ name: 'billingAccounts/a/skus/SKU-IMAGE/price', currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'AUD', units: '60' } }], unitInfo: { unitQuantity: { value: '1000000' } } } }],
    );
    expect(preview.candidates).toEqual([
      expect.objectContaining({ modelId: 'gemini-3.1-flash-image', metric: 'output_image_tokens', priceAud: '60' }),
    ]);
  });

  it('does not label a non-AUD response as AUD', () => {
    const preview = buildGoogleRatePreview(
      [{ skuId: 'SKU-3', displayName: 'Gemini 2.5 Flash Input Tokens' }],
      [{ name: 'billingAccounts/a/skus/SKU-3/price', currencyCode: 'USD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'USD', units: '1' } }], unitInfo: { unitQuantity: { value: '1000000' } } } }],
    );
    expect(preview.candidates).toHaveLength(0);
    expect(preview.warnings[0]?.reason).toContain('AUD');
  });

  it('collapses equivalent SKUs mapped to one provider rate', () => {
    const preview = buildGoogleRatePreview(
      [
        { skuId: 'SKU-B', displayName: 'Gemini 2.5 Pro Input Tokens' },
        { skuId: 'SKU-A', displayName: 'Gemini 2.5 Pro Input Tokens' },
      ],
      ['SKU-B', 'SKU-A'].map(skuId => ({ name: `billingAccounts/a/skus/${skuId}/price`, currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'AUD', units: '2' } }], unitInfo: { unitQuantity: { value: '1000000' } } } })),
    );
    expect(preview.candidates).toEqual([expect.objectContaining({ id: 'SKU-A:input_tokens' })]);
    expect(preview.warnings).toEqual([expect.objectContaining({ skuId: 'SKU-B', reason: expect.stringContaining('Equivalent') })]);
  });

  it('withholds conflicting SKUs mapped to one provider rate', () => {
    const preview = buildGoogleRatePreview(
      [
        { skuId: 'SKU-A', displayName: 'Gemini 2.5 Pro Input Tokens' },
        { skuId: 'SKU-B', displayName: 'Gemini 2.5 Pro Input Tokens' },
      ],
      [
        { name: 'billingAccounts/a/skus/SKU-A/price', currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'AUD', units: '2' } }], unitInfo: { unitQuantity: { value: '1000000' } } } },
        { name: 'billingAccounts/a/skus/SKU-B/price', currencyCode: 'AUD', valueType: 'rate', rate: { tiers: [{ startAmount: { value: '0' }, contractPrice: { currencyCode: 'AUD', units: '3' } }], unitInfo: { unitQuantity: { value: '1000000' } } } },
      ],
    );
    expect(preview.candidates).toHaveLength(0);
    expect(preview.warnings).toHaveLength(2);
    expect(preview.warnings[0]?.reason).toContain('Conflicts');
  });

  it('requires a configured billing account before authentication', async () => {
    delete process.env.GOOGLE_CLOUD_BILLING_ACCOUNT_ID;
    delete process.env.GOOGLE_BILLING_ACCOUNT_ID;
    await expect(fetchGoogleRatePreview()).rejects.toThrow('GOOGLE_CLOUD_BILLING_ACCOUNT_ID');
  });

  it('rejects malformed inline credentials with an actionable error', async () => {
    process.env.GOOGLE_CLOUD_BILLING_ACCOUNT_ID = 'ABC-123';
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = '{bad';
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLIENT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
    await expect(fetchGoogleRatePreview()).rejects.toThrow('not valid JSON');
  });

  it('falls back to the configured credential file when inline credentials are malformed', async () => {
    process.env.GOOGLE_CLOUD_BILLING_ACCOUNT_ID = 'ABC-123';
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = '{bad';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'service-account.json';
    delete process.env.GOOGLE_CLIENT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
    vi.stubGlobal('fetch', vi.fn(async (request: string) => {
      if (String(request).includes('/services')) return Response.json({ billingAccountServices: [{ name: 'billingAccounts/ABC-123/services/gemini', displayName: 'Gemini API' }] });
      return Response.json(String(request).includes('/prices') ? { billingAccountPrices: [] } : { billingAccountSkus: [] });
    }));
    await expect(fetchGoogleRatePreview()).resolves.toEqual(expect.objectContaining({ candidates: [] }));
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