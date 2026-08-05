import { createHmac, timingSafeEqual } from 'crypto';

export class ShopifyCustomerAccountAuthError extends Error {}

export interface ShopifyCustomerAccountIdentity {
  shopDomain: string;
  shopifyCustomerId: string;
  tokenId: string;
}

interface SessionTokenClaims {
  aud?: unknown;
  dest?: unknown;
  exp?: unknown;
  nbf?: unknown;
  sub?: unknown;
  jti?: unknown;
}

function decodePart<T>(part: string): T {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
  } catch {
    throw new ShopifyCustomerAccountAuthError('Invalid Shopify session token.');
  }
}

function normalizeShopDomain(value: unknown): string {
  if (typeof value !== 'string') throw new ShopifyCustomerAccountAuthError('Invalid Shopify session token shop.');
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new ShopifyCustomerAccountAuthError('Invalid Shopify session token shop.');
  }
  return domain;
}

function validAudience(audience: unknown, clientId: string): boolean {
  return audience === clientId || (Array.isArray(audience) && audience.includes(clientId));
}

export function verifyShopifyCustomerAccountToken(input: {
  token: string;
  clientId: string;
  clientSecret: string;
  now?: Date;
}): ShopifyCustomerAccountIdentity {
  const parts = input.token.split('.');
  if (parts.length !== 3 || !input.clientId || !input.clientSecret) {
    throw new ShopifyCustomerAccountAuthError('Invalid Shopify session token.');
  }
  const header = decodePart<{ alg?: unknown; typ?: unknown }>(parts[0]);
  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new ShopifyCustomerAccountAuthError('Invalid Shopify session token.');
  }

  const expected = createHmac('sha256', input.clientSecret).update(`${parts[0]}.${parts[1]}`).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(parts[2], 'base64url');
  } catch {
    throw new ShopifyCustomerAccountAuthError('Invalid Shopify session token.');
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ShopifyCustomerAccountAuthError('Invalid Shopify session token.');
  }

  const claims = decodePart<SessionTokenClaims>(parts[1]);
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!validAudience(claims.aud, input.clientId)) {
    throw new ShopifyCustomerAccountAuthError('Invalid Shopify session token audience.');
  }
  if (!Number.isInteger(claims.exp) || Number(claims.exp) <= now) {
    throw new ShopifyCustomerAccountAuthError('Shopify session token has expired.');
  }
  if (!Number.isInteger(claims.nbf) || Number(claims.nbf) > now + 5) {
    throw new ShopifyCustomerAccountAuthError('Shopify session token is not active.');
  }
  const customerMatch = typeof claims.sub === 'string'
    ? /^gid:\/\/shopify\/Customer\/(\d+)$/.exec(claims.sub)
    : null;
  if (!customerMatch) throw new ShopifyCustomerAccountAuthError('A signed-in Shopify customer is required.');
  if (typeof claims.jti !== 'string' || !claims.jti.trim()) {
    throw new ShopifyCustomerAccountAuthError('Invalid Shopify session token identifier.');
  }

  return {
    shopDomain: normalizeShopDomain(claims.dest),
    shopifyCustomerId: customerMatch[1],
    tokenId: claims.jti,
  };
}