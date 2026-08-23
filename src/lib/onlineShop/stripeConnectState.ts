import { createHmac, timingSafeEqual } from 'crypto';

export interface StripeConnectState { businessId: string; userId: number; nonce: string; expiresAt: number }

function secret(): string {
  const value = process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY || process.env.AUTH_SESSION_SECRET || '';
  if (!value) throw new Error('OAuth state signing is not configured.');
  return value;
}

export function signStripeConnectState(state: StripeConnectState): string {
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  return `${payload}.${createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}

export function verifyStripeConnectState(value: string, now = Date.now()): StripeConnectState | null {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', secret()).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as StripeConnectState;
    return state.businessId && Number.isSafeInteger(state.userId) && state.userId > 0 && state.nonce && state.expiresAt >= now ? state : null;
  } catch { return null; }
}