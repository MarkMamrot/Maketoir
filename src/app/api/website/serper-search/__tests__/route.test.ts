import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reportRuntimeIssue } = vi.hoisted(() => ({ reportRuntimeIssue: vi.fn() }));

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'session' }) }),
}));
vi.mock('@/lib/auth/imsSession', () => ({
  readSession: () => ({ businessId: 'business-1' }),
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue }));

import { POST } from '../route';

const organic = [
  {
    title: 'A Dopo 8oz./226g Blue Cheetahs Ceramic Candle',
    link: 'https://www.animauxspeciaux.com/en/candle-4815',
    snippet: 'Paddywax hand-painted ceramic vessel with blue cheetahs and florals.',
  },
  {
    title: 'paddywax',
    link: 'https://www.harryhartog.com.au/collections/vendors?q=paddywax',
    snippet: 'A Dopo 8 Oz Handpainted Blue Cheetahs',
  },
  {
    title: 'A Dopo Candle 8oz - Blue Cheetahs - Linen Orris',
    link: 'https://hattieandthewolf.com.au/a-dopo-candle-8oz-blue-cheetas-linen-orris/',
    snippet: 'Blue Cheetahs is an exotic scented candle by Paddywax.',
  },
  {
    title: 'A Dopo',
    link: 'https://paddywax.com/collections/a-dopo',
    snippet: 'A collection of A Dopo candles.',
  },
  {
    title: 'A Dopo 8 Oz Handpainted Blue Cheetahs Ceramic w Printed Box',
    link: 'https://www.armchaircollective.com.au/products/a-dopo-blue-cheetahs-candle',
    snippet: 'The Paddywax A Dopo Blue Cheetahs Ceramic Candle features an 8oz hand-painted vessel.',
  },
  {
    title: 'A Dopo Candle - Blue Cheetahs (Linen & Orris)',
    link: 'https://www.wileaway.com.au/products/a-dopo-candle-blue-cheetahs-linen-orris',
    snippet: 'Paddywax 8 oz ceramic candle with hand-painted details. Save 20%off today.',
  },
  {
    title: 'A Dopo Blue Cheetahs on Instagram',
    link: 'https://www.instagram.com/p/DZNtp2alCAr/',
    snippet: 'Paddywax A Dopo Blue Cheetahs candle.',
  },
];

describe('POST /api/website/serper-search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SERPER_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ organic }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
  });

  it('finds exact Blue Cheetahs pages using result titles and snippets', async () => {
    const response = await POST(new Request('http://localhost/api/website/serper-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          name: 'A Dopo 8 Oz Handpainted "Blue Cheetahs" Ceramic w/ Printed Box - Linen & Orris',
          brand: 'Paddywax',
          sku: 'AD0815BXAU',
          barcode: '647658077239',
        },
      }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.urls).toContain('https://www.armchaircollective.com.au/products/a-dopo-blue-cheetahs-candle');
    expect(body.urls).toContain('https://www.wileaway.com.au/products/a-dopo-candle-blue-cheetahs-linen-orris');
    expect(body.urls).toContain('https://hattieandthewolf.com.au/a-dopo-candle-8oz-blue-cheetas-linen-orris/');
    expect(body.urls).not.toContain('https://www.harryhartog.com.au/collections/vendors?q=paddywax');
    expect(body.urls).not.toContain('https://paddywax.com/collections/a-dopo');
    expect(body.candidates).toContainEqual(expect.objectContaining({
      url: 'https://www.armchaircollective.com.au/products/a-dopo-blue-cheetahs-candle',
      evidence: expect.stringContaining('Blue Cheetahs'),
    }));
    expect(body.urls).not.toContain('https://www.instagram.com/p/DZNtp2alCAr/');
    expect(body.discovery).toMatchObject({
      providerResultCount: expect.any(Number),
      candidateCount: body.urls.length,
      filteredCount: expect.any(Number),
    });
    expect(body.discovery.providerResultCount).toBeGreaterThan(body.discovery.candidateCount);
    expect(body.queries).toEqual([
      'A Dopo 8 Oz Handpainted Blue Cheetahs Ceramic w/ Printed Box - Linen & Orris Paddywax',
      'AD0815BXAU',
      '647658077239',
    ]);
    expect(body.executedQueries).toEqual([
      'A Dopo 8 Oz Handpainted Blue Cheetahs Ceramic w/ Printed Box - Linen & Orris Paddywax',
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('accepts a product without brand and still runs discovery', async () => {
    const response = await POST(new Request('http://localhost/api/website/serper-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          name: 'A Dopo 8 Oz Handpainted Blue Cheetahs Ceramic Candle',
          brand: '',
          sku: 'AD0815BXAU',
        },
      }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.urls.length).toBeGreaterThan(0);
    expect(body.queries).toEqual([
      'A Dopo 8 Oz Handpainted Blue Cheetahs Ceramic Candle',
      'AD0815BXAU',
    ]);
    expect(body.executedQueries).toEqual([
      'A Dopo 8 Oz Handpainted Blue Cheetahs Ceramic Candle',
    ]);
  });
});