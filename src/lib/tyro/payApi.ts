import 'server-only';

import crypto from 'node:crypto';

const TOKEN_URL = 'https://auth.connect.tyro.com/oauth/token';
const API_BASE_URL = 'https://api.tyro.com/connect';
const APP_AUDIENCE = 'https://app.connect.tyro';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export type TyroPayEnvironment = 'sandbox' | 'production';
export type TyroPayRequestStatus =
  | 'AWAITING_PAYMENT_INPUT'
  | 'AWAITING_AUTHENTICATION'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'VOIDED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

export interface TyroPayRequest {
  id: string;
  paySecret?: string;
  locationId: string;
  origin: { orderId: string; orderReference?: string; name?: string };
  status: TyroPayRequestStatus;
  total: { amount: number; currency: 'AUD' };
  payMethod?: { id?: string; customerId?: string; save?: boolean };
}

export interface TyroWebhookEvent {
  type: string;
  data: { id: string; uri: string; resource: 'payrequest' | 'paymethod' | 'payrefund' };
}

interface TyroPayConfig {
  environment: TyroPayEnvironment;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  locationId: string;
}

interface TokenCache {
  clientId: string;
  accessToken: string;
  expiresAtMs: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __tyroPayTokenCache: TokenCache | undefined;
  // eslint-disable-next-line no-var
  var __tyroPayTokenRequest: { clientId: string; promise: Promise<string> } | undefined;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function getTyroPayConfig(): TyroPayConfig {
  const environment = required('TYRO_PAY_ENVIRONMENT');
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('TYRO_PAY_ENVIRONMENT must be sandbox or production.');
  }
  return {
    environment,
    clientId: required('TYRO_PAY_CLIENT_ID'),
    clientSecret: required('TYRO_PAY_CLIENT_SECRET'),
    webhookSecret: required('TYRO_PAY_WEBHOOK_HMAC_SECRET'),
    locationId: required('TYRO_PAY_LOCATION_ID'),
  };
}

async function requestAccessToken(config: TyroPayConfig): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      audience: APP_AUDIENCE,
      grant_type: 'client_credentials',
    }).toString(),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Tyro authentication failed with HTTP ${response.status}.`);
  const result = await response.json() as { access_token?: unknown; expires_in?: unknown; token_type?: unknown };
  const accessToken = typeof result.access_token === 'string' ? result.access_token : '';
  const expiresIn = Number(result.expires_in);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0 || result.token_type !== 'Bearer') {
    throw new Error('Tyro authentication returned an invalid response.');
  }
  globalThis.__tyroPayTokenCache = {
    clientId: config.clientId,
    accessToken,
    expiresAtMs: Date.now() + (expiresIn * 1000),
  };
  return accessToken;
}

export async function getTyroPayAccessToken(): Promise<string> {
  const config = getTyroPayConfig();
  const cached = globalThis.__tyroPayTokenCache;
  if (cached?.clientId === config.clientId && cached.expiresAtMs - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
    return cached.accessToken;
  }
  const pending = globalThis.__tyroPayTokenRequest;
  if (pending?.clientId === config.clientId) return pending.promise;
  const promise = requestAccessToken(config).finally(() => {
    if (globalThis.__tyroPayTokenRequest?.promise === promise) globalThis.__tyroPayTokenRequest = undefined;
  });
  globalThis.__tyroPayTokenRequest = { clientId: config.clientId, promise };
  return promise;
}

async function tyroRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = await getTyroPayAccessToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Tyro Pay API request failed with HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

function assertOrderText(value: string, name: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${name} must be between 1 and ${maxLength} characters.`);
  return normalized;
}

export async function createTyroPayRequest(input: {
  orderId: string;
  orderReference?: string;
  amountCents: number;
  statementDescriptor?: string;
}): Promise<TyroPayRequest> {
  const config = getTyroPayConfig();
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error('Tyro payment amount must be positive cents.');
  const orderId = assertOrderText(input.orderId, 'Tyro order ID', 50);
  const orderReference = input.orderReference?.trim();
  const statementDescriptor = input.statementDescriptor?.trim();
  if (statementDescriptor && statementDescriptor.length > 21) throw new Error('Tyro statement descriptor cannot exceed 21 characters.');
  return tyroRequest<TyroPayRequest>('/pay/requests', {
    method: 'POST',
    body: JSON.stringify({
      locationId: config.locationId,
      provider: { name: 'TYRO', method: 'CARD' },
      origin: { orderId, ...(orderReference ? { orderReference } : {}), name: 'Solvantis' },
      total: { amount: input.amountCents, currency: 'AUD' },
      ...(statementDescriptor ? { statementDescriptor } : {}),
    }),
  });
}

export async function getTyroPayRequest(payRequestId: string): Promise<TyroPayRequest> {
  const id = assertOrderText(payRequestId, 'Tyro Pay Request ID', 191);
  return tyroRequest<TyroPayRequest>(`/pay/requests/${encodeURIComponent(id)}`);
}

export async function createTyroRefund(input: { payRequestId: string; amountCents: number }): Promise<{
  id: string;
  payRequestId: string;
  status: 'SUCCESS' | 'FAILED' | 'PROCESSING';
  total: { amount: number; currency: 'AUD' };
}> {
  const payRequestId = assertOrderText(input.payRequestId, 'Tyro Pay Request ID', 191);
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error('Tyro refund amount must be positive cents.');
  return tyroRequest('/pay/refunds', {
    method: 'POST',
    body: JSON.stringify({ payRequestId, total: { amount: input.amountCents, currency: 'AUD' } }),
  });
}

function signatureCandidates(signature: string): string[] {
  const value = signature.trim();
  const withoutPrefix = value.replace(/^sha256=/i, '');
  return withoutPrefix === value ? [value] : [value, withoutPrefix];
}

export function verifyTyroWebhookSignature(payload: Uint8Array, signature: string): boolean {
  const secret = getTyroPayConfig().webhookSecret;
  const digest = crypto.createHmac('sha256', secret).update(payload);
  const expected = [digest.digest('hex')];
  expected.push(Buffer.from(expected[0], 'hex').toString('base64'));
  return signatureCandidates(signature).some(candidate => expected.some(value => {
    const supplied = Buffer.from(candidate, 'utf8');
    const calculated = Buffer.from(value, 'utf8');
    return supplied.length === calculated.length && crypto.timingSafeEqual(supplied, calculated);
  }));
}

export function parseTyroWebhookEvent(payload: Uint8Array): TyroWebhookEvent {
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(payload).toString('utf8')); }
  catch { throw new Error('Tyro webhook payload is not valid JSON.'); }
  const event = parsed as Partial<TyroWebhookEvent>;
  const type = typeof event.type === 'string' ? event.type.trim() : '';
  const id = typeof event.data?.id === 'string' ? event.data.id.trim() : '';
  const uri = typeof event.data?.uri === 'string' ? event.data.uri.trim() : '';
  const resource = event.data?.resource;
  if (!type || !id || !uri || !['payrequest', 'paymethod', 'payrefund'].includes(String(resource))) {
    throw new Error('Tyro webhook payload is incomplete.');
  }
  let resourceUrl: URL;
  try { resourceUrl = new URL(uri); }
  catch { throw new Error('Tyro webhook resource URI is invalid.'); }
  if (resourceUrl.protocol !== 'https:' || resourceUrl.hostname !== 'api.tyro.com'
    || !resourceUrl.pathname.startsWith('/connect/') || !resourceUrl.pathname.endsWith(`/${id}`)) {
    throw new Error('Tyro webhook resource URI is not trusted.');
  }
  return { type, data: { id, uri, resource: resource as TyroWebhookEvent['data']['resource'] } };
}

export function resetTyroPayTokenCacheForTests(): void {
  if (process.env.NODE_ENV !== 'test') return;
  globalThis.__tyroPayTokenCache = undefined;
  globalThis.__tyroPayTokenRequest = undefined;
}