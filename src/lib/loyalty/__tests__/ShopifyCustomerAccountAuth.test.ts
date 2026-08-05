import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';

import {
  ShopifyCustomerAccountAuthError,
  verifyShopifyCustomerAccountToken,
} from '../ShopifyCustomerAccountAuth';

function token(claims: Record<string, unknown>, secret = 'app-secret'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const claims = {
  aud: 'client-id',
  dest: 'https://example.myshopify.com',
  exp: 1_800_000_300,
  nbf: 1_800_000_000,
  iat: 1_800_000_000,
  jti: 'token-id',
  sub: 'gid://shopify/Customer/12345',
};

describe('verifyShopifyCustomerAccountToken', () => {
  it('verifies the signature and returns the exact shop and customer identities', () => {
    expect(verifyShopifyCustomerAccountToken({
      token: token(claims), clientId: 'client-id', clientSecret: 'app-secret', now: new Date(1_800_000_100_000),
    })).toEqual({ shopDomain: 'example.myshopify.com', shopifyCustomerId: '12345', tokenId: 'token-id' });
  });

  it.each([
    ['wrong signature', token(claims, 'wrong-secret')],
    ['wrong audience', token({ ...claims, aud: 'other-client' })],
    ['expired token', token({ ...claims, exp: 1_800_000_100 })],
    ['missing customer', token({ ...claims, sub: undefined })],
    ['invalid shop', token({ ...claims, dest: 'https://attacker.example.com' })],
  ])('rejects %s', (_case, value) => {
    expect(() => verifyShopifyCustomerAccountToken({
      token: value, clientId: 'client-id', clientSecret: 'app-secret', now: new Date(1_800_000_100_000),
    })).toThrow(ShopifyCustomerAccountAuthError);
  });
});