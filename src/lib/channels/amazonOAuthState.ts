import { createHmac, timingSafeEqual } from 'crypto';

export interface AmazonOAuthState {
  businessId: string;
  userId: number;
  nonce: string;
  displayName: string;
  expiresAt: number;
}

function stateSecret(): string {
  const value = process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY || process.env.CRON_SECRET || '';
  if (!value) throw new Error('OAUTH_STATE_SECRET or ENCRYPTION_KEY must be configured.');
  return value;
}

export function signAmazonOAuthState(state: AmazonOAuthState): string {
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  const signature = createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyAmazonOAuthState(value: string, now = Date.now()): AmazonOAuthState | null {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', stateSecret()).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AmazonOAuthState;
    if (!parsed.businessId || !Number.isInteger(parsed.userId) || parsed.userId <= 0 || !parsed.nonce
      || !parsed.displayName?.trim() || parsed.displayName.length > 120 || parsed.expiresAt < now) return null;
    return parsed;
  } catch {
    return null;
  }
}
