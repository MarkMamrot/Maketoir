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
});
