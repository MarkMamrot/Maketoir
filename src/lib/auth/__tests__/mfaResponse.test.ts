import { describe, expect, it } from 'vitest';

import { MFA_RETRY_MESSAGE, parseMfaResponse } from '../mfaResponse';

describe('parseMfaResponse', () => {
  it('parses a JSON response', async () => {
    const response = new Response('{"nextRoute":"/ims"}', {
      headers: { 'content-type': 'application/json' },
    });

    await expect(parseMfaResponse(response)).resolves.toEqual({ nextRoute: '/ims' });
  });

  it('turns an HTML response into a safe retry message', async () => {
    const response = new Response('<!DOCTYPE html><title>Bad gateway</title>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    });

    await expect(parseMfaResponse(response)).rejects.toThrow(MFA_RETRY_MESSAGE);
  });
});