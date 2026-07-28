import { createHmac, timingSafeEqual } from 'crypto';

interface GmailOAuthState {
  businessId: string;
  userId: number;
  nonce: string;
  expiresAt: number;
}

function secret(): string {
  const value = process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY || process.env.CRON_SECRET || '';
  if (!value) throw new Error('OAUTH_STATE_SECRET or ENCRYPTION_KEY must be configured');
  return value;
}

export function signGmailOAuthState(state: GmailOAuthState): string {
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyGmailOAuthState(value: string): GmailOAuthState | null {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', secret()).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GmailOAuthState;
    if (!parsed.businessId || !parsed.userId || !parsed.nonce || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}