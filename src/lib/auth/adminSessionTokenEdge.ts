const TOKEN_VERSION = 1;
const MIN_SECRET_BYTES = 32;
const MAX_CLOCK_SKEW_SECONDS = 60;

interface SignedSessionEnvelope<T extends object> {
  v: number;
  iat: number;
  exp: number;
  data: T;
}

function decodeBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const decoded = atob(padded);
    return Uint8Array.from(decoded, character => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function verifyAdminSessionEdge<T extends object>(token: string, nowMs = Date.now()): Promise<T | null> {
  let parsed: T & { __session?: SignedSessionEnvelope<T>; __signature?: string };
  try {
    parsed = JSON.parse(token) as T & { __session?: SignedSessionEnvelope<T>; __signature?: string };
  } catch {
    return null;
  }

  const envelope = parsed?.__session;
  const suppliedSignature = typeof parsed?.__signature === 'string'
    ? decodeBase64Url(parsed.__signature)
    : null;
  if (!envelope || !suppliedSignature) return null;

  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || new TextEncoder().encode(secret).length < MIN_SECRET_BYTES) {
    throw new Error('AUTH_SESSION_SECRET must be at least 32 bytes.');
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expectedSignature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(envelope))),
  );
  if (!equalBytes(suppliedSignature, expectedSignature)) return null;

  if (
    envelope.v !== TOKEN_VERSION ||
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

  const now = Math.floor(nowMs / 1000);
  if (envelope.exp <= now || envelope.iat > now + MAX_CLOCK_SKEW_SECONDS) return null;

  return envelope.data;
}