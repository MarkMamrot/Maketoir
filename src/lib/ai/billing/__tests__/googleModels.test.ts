import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGoogleModels } from '../googleModels';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.unstubAllGlobals();
});

describe('Google Models API discovery', () => {
  it('follows pagination and retains canonical metadata', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const fetchMock = vi.fn(async (request: URL) => request.searchParams.get('pageToken')
      ? Response.json({ models: [{ name: 'models/veo-3.1-generate-preview', displayName: 'Veo 3.1', supportedGenerationMethods: ['predictLongRunning'] }] })
      : Response.json({ models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', version: '2.5', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1_048_576 }], nextPageToken: 'next' }));
    vi.stubGlobal('fetch', fetchMock);
    const models = await fetchGoogleModels();
    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'gemini-2.5-pro', version: '2.5', inputTokenLimit: 1_048_576 }),
      expect.objectContaining({ modelId: 'veo-3.1-generate-preview', outputModalities: ['video'] }),
    ]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retains the existing catalog when Google returns no models', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ models: [] })));
    await expect(fetchGoogleModels()).rejects.toThrow('existing catalog was retained');
  });
});