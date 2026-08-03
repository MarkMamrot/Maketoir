import { describe, expect, it } from 'vitest';

import { parseAiJsonResponse } from '../aiJsonResponse';

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