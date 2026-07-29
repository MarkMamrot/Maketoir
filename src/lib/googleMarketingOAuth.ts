import { createHmac, timingSafeEqual } from 'crypto';

export interface GoogleMarketingOAuthState {
  businessId: string;
  userId: number;
  nonce: string;
  expiresAt: number;
}

export interface GoogleAdsAccountOption {
  customerId: string;
  name: string;
  manager: boolean;
}

export interface GoogleAnalyticsPropertyOption {
  propertyId: string;
  name: string;
  accountName: string;
}

function stateSecret(): string {
  const value = process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY || process.env.CRON_SECRET || '';
  if (!value) throw new Error('OAUTH_STATE_SECRET or ENCRYPTION_KEY must be configured.');
  return value;
}

export function signGoogleMarketingOAuthState(state: GoogleMarketingOAuthState): string {
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  const signature = createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyGoogleMarketingOAuthState(value: string, now = Date.now()): GoogleMarketingOAuthState | null {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', stateSecret()).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GoogleMarketingOAuthState;
    if (!parsed.businessId || !Number.isInteger(parsed.userId) || parsed.userId <= 0 || !parsed.nonce || parsed.expiresAt < now) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function normalizeGoogleCustomerId(value: unknown): string | null {
  const customerId = String(value ?? '').replace(/-/g, '').trim();
  return /^\d{10}$/.test(customerId) ? customerId : null;
}

export function normalizeGooglePropertyId(value: unknown): string | null {
  const propertyId = String(value ?? '').replace(/^properties\//i, '').trim();
  return /^\d+$/.test(propertyId) ? propertyId : null;
}
