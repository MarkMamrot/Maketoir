import { createHmac, timingSafeEqual } from 'crypto';

export const ONLINE_SHOP_SESSION_COOKIE = 'solvantis_shop_session';
export const ONLINE_SHOP_SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export interface OnlineShopSession {
  businessId: string;
  contactId: number;
  email: string;
  storeSlug: string;
  expiresAt: number;
}

function secret(): string {
  const value = process.env.AUTH_SESSION_SECRET;
  if (!value || Buffer.byteLength(value, 'utf8') < 32) throw new Error('AUTH_SESSION_SECRET must be at least 32 bytes.');
  return value;
}

export function signOnlineShopSession(input: Omit<OnlineShopSession, 'expiresAt'>, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...input, expiresAt: now + ONLINE_SHOP_SESSION_MAX_AGE * 1000 }), 'utf8').toString('base64url');
  return `${payload}.${createHmac('sha256', secret()).update(`native-shop:${payload}`).digest('base64url')}`;
}

export function verifyOnlineShopSession(token: string, now = Date.now()): OnlineShopSession | null {
  const [payload, signature] = token.split('.'); if (!payload || !signature) return null;
  const expected = createHmac('sha256', secret()).update(`native-shop:${payload}`).digest();
  let actual: Buffer; try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OnlineShopSession;
    if (!session.businessId || !Number.isSafeInteger(session.contactId) || session.contactId <= 0 || !session.email || !session.storeSlug || session.expiresAt <= now) return null;
    return session;
  } catch { return null; }
}