import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reportRuntimeIssue } = vi.hoisted(() => ({ reportRuntimeIssue: vi.fn() }));

vi.mock('@/lib/auth/imsSession', () => ({
  getImsSession: () => ({ businessId: 'business-1' }),
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue }));

import { POST } from '../route';

describe('POST /api/website/judge-urls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
  });

  it('fails closed when both Gemini attempts stop without response text', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(new Request('http://localhost/api/website/judge-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: { name: 'Baby Hat / Flutterby', brand: 'Halcyon Nights' },
        urls: ['https://example.com/product'],
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      validUrlFound: false,
      assessmentUnavailable: true,
      assessmentMethod: 'search-evidence',
      rankedUrls: [{
        url: 'https://example.com/product',
        keep: false,
        confidence: 0,
      }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('returns a decision row for every candidate when Gemini selects only one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
        rankedUrls: [{ url: 'https://shop.example.com/right-product', keep: true, reason: 'Exact product.' }],
      }) }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(new Request('http://localhost/api/website/judge-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: { name: 'Ducky Mug', brand: 'Decole' },
        urls: ['https://shop.example.com/right-product', 'https://shop.example.com/wrong-product'],
        candidates: [{ url: 'https://shop.example.com/right-product', evidence: 'Decole Ducky Mug exact product listing.' }],
      }),
    }));

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      validUrlFound: true,
      rankedUrls: [
        { url: 'https://shop.example.com/right-product', keep: true },
        { url: 'https://shop.example.com/wrong-product', keep: false },
      ],
    });
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.tools).toBeUndefined();
    expect(requestBody.contents[0].parts[0].text).toContain('Decole Ducky Mug exact product listing.');
  });

  it('prefers a supplier page scoring at least 50 over a higher-scoring retailer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
        rankedUrls: [
          { url: 'https://supplier.example/products/chino-mug-daisy-green', confidence: 72, reason: 'Exact supplier product.' },
          { url: 'https://retailer.example/products/chino-mug-daisy-green', confidence: 94, reason: 'Exact retailer product.' },
        ],
      }) }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const response = await POST(new Request('http://localhost/api/website/judge-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: { name: 'Chino Mug Daisy Green', brand: 'Jones & Co' },
        urls: [
          'https://supplier.example/products/chino-mug-daisy-green',
          'https://retailer.example/products/chino-mug-daisy-green',
        ],
        preferredSites: ['https://supplier.example'],
      }),
    }));

    await expect(response.json()).resolves.toMatchObject({
      validUrlFound: true,
      selectedUrl: 'https://supplier.example/products/chino-mug-daisy-green',
      rankedUrls: [
        { keep: true, confidence: 72, preferred: true },
        { keep: false, confidence: 94, preferred: false },
      ],
    });
  });

  it('selects the highest candidate when no preferred page reaches 50', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
        rankedUrls: [
          { url: 'https://supplier.example/products/mug', confidence: 42, reason: 'Supplier page is ambiguous.' },
          { url: 'https://retailer.example/products/chino-mug-daisy-green', confidence: 88, reason: 'Exact retailer product.' },
        ],
      }) }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const response = await POST(new Request('http://localhost/api/website/judge-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: { name: 'Chino Mug Daisy Green', brand: 'Jones & Co' },
        urls: ['https://supplier.example/products/mug', 'https://retailer.example/products/chino-mug-daisy-green'],
        preferredSites: ['supplier.example'],
      }),
    }));

    await expect(response.json()).resolves.toMatchObject({
      validUrlFound: true,
      selectedUrl: 'https://retailer.example/products/chino-mug-daisy-green',
    });
  });

  it('requires manual confirmation when every confidence is below 50', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
        rankedUrls: [{ url: 'https://retailer.example/products/mug', confidence: 49, reason: 'Possibly related.' }],
      }) }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const response = await POST(new Request('http://localhost/api/website/judge-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: { name: 'Chino Mug Daisy Green', brand: 'Jones & Co' },
        urls: ['https://retailer.example/products/mug'],
      }),
    }));

    await expect(response.json()).resolves.toMatchObject({
      validUrlFound: false,
      selectedUrl: '',
      rankedUrls: [{ confidence: 49, keep: false }],
    });
  });

  it('returns confirmation candidates instead of an error when matching times out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')));

    const response = await POST(new Request('http://localhost/api/website/judge-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: { name: 'Capy Fathers Day Card', brand: 'Jolly Awesome' },
        urls: ['https://example.com/capy-fathers-day-card'],
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      validUrlFound: false,
      assessmentUnavailable: true,
      assessmentMethod: 'search-evidence',
      rankedUrls: [{ keep: false, confidence: 49 }],
    });
    expect(reportRuntimeIssue).toHaveBeenCalledOnce();
  });

  it('selects an exact product-page result when Gemini times out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')));

    const url = 'https://jonesandco.example/products/chino-mug-daisy-green';
    const response = await POST(new Request('http://localhost/api/website/judge-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: { name: 'Chino Mug Daisy Green', brand: 'Jones & Co' },
        urls: [url],
        candidates: [{ url, evidence: 'Jones & Co Chino Mug Daisy Green | Hand-painted ceramic mug' }],
        preferredSites: ['jonesandco.example'],
      }),
    }));

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      validUrlFound: true,
      selectedUrl: url,
      assessmentUnavailable: false,
      assessmentMethod: 'search-evidence',
      rankedUrls: [{ url, keep: true, confidence: 92, preferred: true }],
    });
    expect(reportRuntimeIssue).toHaveBeenCalledOnce();
  });
});
