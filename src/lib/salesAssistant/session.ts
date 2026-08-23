import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const PROSPECT_SESSION_COOKIE = 'solvantis_prospect';
export const PROSPECT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const SESSION_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface ProspectSessionCookie {
  name: typeof PROSPECT_SESSION_COOKIE;
  value: string;
  options: {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    path: '/';
    maxAge: number;
  };
}

export function createProspectSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function isValidProspectSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_PATTERN.test(value);
}

export function readProspectSessionId(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== PROSPECT_SESSION_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return isValidProspectSessionId(value) ? value : null;
  }
  return null;
}

export function getOrCreateProspectSession(cookieHeader: string | null, production = process.env.NODE_ENV === 'production'): {
  sessionId: string;
  cookie: ProspectSessionCookie | null;
} {
  const existing = readProspectSessionId(cookieHeader);
  if (existing) return { sessionId: existing, cookie: null };
  const sessionId = createProspectSessionId();
  return {
    sessionId,
    cookie: {
      name: PROSPECT_SESSION_COOKIE,
      value: sessionId,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: production,
        path: '/',
        maxAge: PROSPECT_SESSION_MAX_AGE_SECONDS,
      },
    },
  };
}

function expectedOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host') || url.host;
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol || url.protocol.replace(':', '');
  return `${protocol}://${host}`.toLowerCase();
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const supplied = new URL(origin).origin.toLowerCase();
    const expected = expectedOrigin(request);
    const left = Buffer.from(supplied);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function networkFingerprint(request: Request, secret = process.env.SALES_ASSISTANT_HMAC_SECRET): string {
  if (!secret || secret.length < 32) throw new Error('SALES_ASSISTANT_HMAC_SECRET must be at least 32 characters.');
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
  const userAgent = request.headers.get('user-agent')?.slice(0, 500) || 'unknown';
  return createHmac('sha256', secret).update(`${ip}\n${userAgent}`).digest('hex');
}
