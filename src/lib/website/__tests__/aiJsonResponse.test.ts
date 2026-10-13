import { describe, expect, it, vi } from 'vitest';

import { parseAiJsonResponse, requestAiJsonResponse } from '../aiJsonResponse';

describe('requestAiJsonResponse', () => {
  function response(text: string) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
  }

  it.each(['TimeoutError', 'AbortError', 'Error'])('never retries a transport failure (%s)', async name => {
    const error = new Error('Request aborted');
    error.name = name;
    const request = vi.fn().mockRejectedValue(error);
    expect(await requestAiJsonResponse(request)).toMatchObject({ parsed: null, requestFailed: true, attempts: 1 });
    expect(request).toHaveBeenCalledOnce();
  });

  it('retries one completed malformed response and accepts the next valid object', async () => {
    const request = vi.fn().mockResolvedValueOnce(response('{"title":'))
      .mockResolvedValueOnce(response('{"title":"Duck"}'));
    expect(await requestAiJsonResponse(request)).toMatchObject({ parsed: { title: 'Duck' }, attempts: 2, requestFailed: false });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not retry again when a parse retry has an unknown transport outcome', async () => {
    const request = vi.fn().mockResolvedValueOnce(response('{"title":')).mockRejectedValueOnce(new Error('Request aborted'));
    expect(await requestAiJsonResponse(request)).toMatchObject({ parsed: null, requestFailed: true, attempts: 2 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed response shapes and non-object generated JSON without crashing', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: 'invalid' } }] })))
      .mockResolvedValueOnce(response('["not a content object"]'));
    expect(await requestAiJsonResponse(request)).toMatchObject({ parsed: null, requestFailed: false, attempts: 2 });
  });

  it('does not retry an unsuccessful provider response', async () => {
    const request = vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 }));
    expect(await requestAiJsonResponse(request)).toMatchObject({ parsed: null, requestFailed: true, attempts: 1 });
    expect(request).toHaveBeenCalledOnce();
  });
});

describe('parseAiJsonResponse', () => {
  it('parses fenced JSON and explanatory text around a balanced object', () => {
    expect(parseAiJsonResponse('Result:\n```json\n{"title":"Duck"}\n```')).toEqual({ title: 'Duck' });
  });

  it('checks every Gemini text part and prefers the final valid response', () => {
    expect(parseAiJsonResponse(['Searching for product', '{"rankedUrls":[]}'])).toEqual({ rankedUrls: [] });
  });

  it('repairs raw control characters and trailing commas without altering HTML', () => {
    const response = '{"websiteDescription":"<p>First line\nSecond line</p>","tags":"duck, toy",}';
    expect(parseAiJsonResponse(response)).toEqual({
      websiteDescription: '<p>First line\nSecond line</p>',
      tags: 'duck, toy',
    });
  });

  it('rejects truncated JSON', () => {
    expect(parseAiJsonResponse('{"title":"Duck"')).toBeNull();
  });
});