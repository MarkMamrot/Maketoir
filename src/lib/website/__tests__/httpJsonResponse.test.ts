import { describe, expect, it } from 'vitest';

import { parseWebsiteJsonResponse } from '../httpJsonResponse';

describe('parseWebsiteJsonResponse', () => {
  it('parses JSON responses', async () => {
    await expect(parseWebsiteJsonResponse(new Response('{"success":true}'))).resolves.toEqual({ success: true });
  });

  it('turns an HTML gateway response into a useful timeout error', async () => {
    const response = new Response('<!DOCTYPE html><title>Bad gateway</title>', { status: 502 });
    await expect(parseWebsiteJsonResponse(response)).rejects.toThrow('website-content request timed out');
  });
});