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
    await expect(response.json()).resolves.toEqual({
      success: true,
      validUrlFound: false,
      rankedUrls: [{
        url: 'https://example.com/product',
        keep: false,
        reason: 'The product page could not be verified.',
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
      rankedUrls: [{ keep: false, reason: expect.stringContaining('inconclusive') }],
    });
    expect(reportRuntimeIssue).toHaveBeenCalledOnce();
  });
});
