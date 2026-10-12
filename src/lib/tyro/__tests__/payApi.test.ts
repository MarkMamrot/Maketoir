import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createTyroPayRequest,
  getTyroPayAccessToken,
  parseTyroWebhookEvent,
  resetTyroPayTokenCacheForTests,
  verifyTyroWebhookSignature,
} from '../payApi';

const env = {
  TYRO_PAY_ENVIRONMENT: 'sandbox',
  TYRO_PAY_CLIENT_ID: 'sandbox-client',
  TYRO_PAY_CLIENT_SECRET: 'sandbox-secret',
  TYRO_PAY_WEBHOOK_HMAC_SECRET: 'webhook-secret',
  TYRO_PAY_LOCATION_ID: 'tc-test-3000',
};

describe('Tyro Pay API', () => {
  beforeEach(() => {
    vi.stubEnv('TYRO_PAY_ENVIRONMENT', env.TYRO_PAY_ENVIRONMENT);
    vi.stubEnv('TYRO_PAY_CLIENT_ID', env.TYRO_PAY_CLIENT_ID);
    vi.stubEnv('TYRO_PAY_CLIENT_SECRET', env.TYRO_PAY_CLIENT_SECRET);
    vi.stubEnv('TYRO_PAY_WEBHOOK_HMAC_SECRET', env.TYRO_PAY_WEBHOOK_HMAC_SECRET);
    vi.stubEnv('TYRO_PAY_LOCATION_ID', env.TYRO_PAY_LOCATION_ID);
    resetTyroPayTokenCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetTyroPayTokenCacheForTests();
  });

  it('shares one OAuth request across concurrent callers and caches the token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'jwt-value', expires_in: 43_200, token_type: 'Bearer',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await Promise.all([getTyroPayAccessToken(), getTyroPayAccessToken()])).toEqual(['jwt-value', 'jwt-value']);
    expect(await getTyroPayAccessToken()).toBe('jwt-value');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://auth.connect.tyro.com/oauth/token');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(Object.fromEntries(new URLSearchParams(fetchMock.mock.calls[0][1].body))).toEqual({
      client_id: 'sandbox-client',
      client_secret: 'sandbox-secret',
      audience: 'https://app.connect.tyro',
      grant_type: 'client_credentials',
    });
  });

  it('creates an AUD card Pay Request without exposing credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'jwt-value', expires_in: 43_200, token_type: 'Bearer' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'pay-1', paySecret: 'temporary-secret', locationId: 'tc-test-3000',
        origin: { orderId: 'CERT-1' }, status: 'AWAITING_PAYMENT_INPUT', total: { amount: 1250, currency: 'AUD' },
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createTyroPayRequest({ orderId: 'CERT-1', orderReference: 'Certification', amountCents: 1250 });
    expect(result.id).toBe('pay-1');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.tyro.com/connect/pay/requests');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      locationId: 'tc-test-3000',
      provider: { name: 'TYRO', method: 'CARD' },
      origin: { orderId: 'CERT-1', orderReference: 'Certification', name: 'Solvantis' },
      total: { amount: 1250, currency: 'AUD' },
    });
    expect(fetchMock.mock.calls[1][1].headers).toEqual(expect.objectContaining({ Authorization: 'Bearer jwt-value' }));
  });

  it('verifies hex and base64 HMAC signatures against the untouched request bytes', () => {
    const payload = Buffer.from('{"type":"PAY_REQUEST_SUCCESS","data":{"id":"pay-1"}}');
    const hex = crypto.createHmac('sha256', env.TYRO_PAY_WEBHOOK_HMAC_SECRET).update(payload).digest('hex');
    const base64 = Buffer.from(hex, 'hex').toString('base64');
    expect(verifyTyroWebhookSignature(payload, hex)).toBe(true);
    expect(verifyTyroWebhookSignature(payload, base64)).toBe(true);
    expect(verifyTyroWebhookSignature(payload, `${hex}x`)).toBe(false);
  });

  it('accepts only trusted Tyro resource URIs', () => {
    const valid = Buffer.from(JSON.stringify({
      type: 'PAY_REQUEST_SUCCESS',
      data: { id: 'pay-1', uri: 'https://api.tyro.com/connect/pay/requests/pay-1', resource: 'payrequest' },
    }));
    expect(parseTyroWebhookEvent(valid).data.id).toBe('pay-1');

    const untrusted = Buffer.from(JSON.stringify({
      type: 'PAY_REQUEST_SUCCESS',
      data: { id: 'pay-1', uri: 'https://example.com/connect/pay/requests/pay-1', resource: 'payrequest' },
    }));
    expect(() => parseTyroWebhookEvent(untrusted)).toThrow('not trusted');
  });
});