import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_VERSION = 1;
const MIN_SECRET_BYTES = 32;
const MAX_CLOCK_SKEW_SECONDS = 60;

export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

interface SignedSessionEnvelope<T extends object> {
  v: number;
  iat: number;
  exp: number;
  data: T;
}

interface SignSessionOptions {
  maxAgeSeconds: number;
  nowMs?: number;
}

interface VerifySessionOptions {
  nowMs?: number;
}

export interface VerifiedAdminSession<T extends object> {
  data: T;
  issuedAt: number;
  expiresAt: number;
}

function getSigningSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
    throw new Error('AUTH_SESSION_SECRET must be at least 32 bytes.');
  }
  return secret;
}

function sign(serializedPayload: string): Buffer {
  return createHmac('sha256', getSigningSecret()).update(serializedPayload).digest();
}

export function signAdminSession<T extends object>(data: T, options: SignSessionOptions): string {
  if (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds <= 0) {
    throw new Error('Session maxAgeSeconds must be a positive integer.');
  }

  const issuedAt = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const envelope: SignedSessionEnvelope<T> = {
    v: TOKEN_VERSION,
    iat: issuedAt,
    exp: issuedAt + options.maxAgeSeconds,
    data,
  };
  const serializedEnvelope = JSON.stringify(envelope);
  const signature = sign(serializedEnvelope).toString('base64url');
  return JSON.stringify({ ...data, __session: envelope, __signature: signature });
}

export function verifyAdminSessionDetails<T extends object>(token: string, options: VerifySessionOptions = {}): VerifiedAdminSession<T> | null {
  let parsed: T & { __session?: SignedSessionEnvelope<T>; __signature?: string };
  try {
    parsed = JSON.parse(token) as T & { __session?: SignedSessionEnvelope<T>; __signature?: string };
  } catch {
    return null;
  }

  const envelope = parsed?.__session;
  const encodedSignature = parsed?.__signature;
  if (!envelope || typeof encodedSignature !== 'string') return null;

  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(encodedSignature, 'base64url');
  } catch {
    return null;
  }

  const expectedSignature = sign(JSON.stringify(envelope));
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  if (
    envelope?.v !== TOKEN_VERSION ||
    !Number.isSafeInteger(envelope.iat) ||
    !Number.isSafeInteger(envelope.exp) ||
    envelope.exp <= envelope.iat ||
    !envelope.data ||
    typeof envelope.data !== 'object'
  ) {
    return null;
  }

  const { __session: _session, __signature: _signature, ...visibleData } = parsed;
  if (JSON.stringify(visibleData) !== JSON.stringify(envelope.data)) return null;

  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (envelope.exp <= now || envelope.iat > now + MAX_CLOCK_SKEW_SECONDS) return null;

  return {
    data: envelope.data,
    issuedAt: envelope.iat,
    expiresAt: envelope.exp,
  };
}

export function verifyAdminSession<T extends object>(token: string, options: VerifySessionOptions = {}): T | null {
  return verifyAdminSessionDetails<T>(token, options)?.data ?? null;
}