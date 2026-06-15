/**
 * XeroService — OAuth 2.0 PKCE + Xero API wrapper.
 *
 * - Handles token exchange (authorization_code → tokens)
 * - Auto-refreshes expired access tokens
 * - Provides typed helpers for common Xero accounting endpoints
 *
 * Credentials flow:
 *   XERO_CLIENT_ID and XERO_REDIRECT_URI from .env (app-level, shared).
 *   Per-business tokens (access, refresh, tenant) stored encrypted in `connections` table.
 */

import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { encrypt, decrypt } from '@/lib/encryption';

// ─── Config ──────────────────────────────────────────────────────────────────

const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

function getClientId(): string {
  return process.env.XERO_CLIENT_ID ?? '';
}
function getRedirectUri(): string {
  return process.env.XERO_REDIRECT_URI ?? '';
}

export function isXeroConfigured(): boolean {
  return !!getClientId() && !!getRedirectUri();
}

// ─── PKCE Helpers ─────────────────────────────────────────────────────────────

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  const { randomBytes } = require('crypto');
  return base64UrlEncode(randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  const { createHash } = require('crypto');
  const hash = createHash('sha256').update(verifier).digest();
  return base64UrlEncode(hash);
}

// ─── OAuth URLs ──────────────────────────────────────────────────────────────

const SCOPES = [
  'openid', 'profile', 'email', 'offline_access',
  'accounting.transactions', 'accounting.contacts',
  'accounting.settings', 'accounting.journals',
].join(' ');

export function buildAuthorizeUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${XERO_AUTH_URL}?${params.toString()}`;
}

// ─── Token Exchange ──────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
  scope: string;
}

export async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<TokenResponse> {
  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: getClientId(),
      code,
      redirect_uri: getRedirectUri(),
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: getClientId(),
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero token refresh failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ─── Tenant Discovery ────────────────────────────────────────────────────────

interface XeroTenant {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantType: string;
}

export async function getConnectedTenants(accessToken: string): Promise<XeroTenant[]> {
  const res = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Failed to get Xero tenants (${res.status})`);
  return res.json();
}

// ─── Persisted Token Management ──────────────────────────────────────────────

/**
 * Save tokens + tenant info to the connections table (encrypted).
 */
export async function saveXeroTokens(
  businessId: string,
  tokens: TokenResponse,
  tenantId: string,
  tenantName: string,
): Promise<void> {
  const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await ConnectionsRepository.upsert(businessId, {
    xero_access_token: encrypt(tokens.access_token),
    xero_refresh_token: encrypt(tokens.refresh_token),
    xero_tenant_id: tenantId,
    xero_tenant_name: tenantName,
    xero_token_expiry: expiry,
  });
}

/**
 * Clear all Xero credentials for a business.
 */
export async function clearXeroTokens(businessId: string): Promise<void> {
  await ConnectionsRepository.upsert(businessId, {
    xero_access_token: null,
    xero_refresh_token: null,
    xero_tenant_id: null,
    xero_tenant_name: null,
    xero_token_expiry: null,
  });
}

// ─── Authenticated API Client ────────────────────────────────────────────────

/**
 * Get a valid access token for a business, refreshing if expired.
 * Throws if no Xero connection exists.
 */
export async function getValidAccessToken(businessId: string): Promise<{ accessToken: string; tenantId: string }> {
  const conn = await ConnectionsRepository.get(businessId);
  if (!conn?.xero_refresh_token || !conn?.xero_tenant_id) {
    throw new Error('No Xero connection found for this business.');
  }

  const accessToken = decrypt(conn.xero_access_token ?? '');
  const refreshToken = decrypt(conn.xero_refresh_token);
  const expiry = conn.xero_token_expiry ? new Date(conn.xero_token_expiry).getTime() : 0;

  // If token still valid (with 60s buffer), use it
  if (accessToken && expiry > Date.now() + 60_000) {
    return { accessToken, tenantId: conn.xero_tenant_id };
  }

  // Refresh
  const tokens = await refreshAccessToken(refreshToken);
  await saveXeroTokens(businessId, tokens, conn.xero_tenant_id, conn.xero_tenant_name ?? '');
  return { accessToken: tokens.access_token, tenantId: conn.xero_tenant_id };
}

/**
 * Make an authenticated GET/POST/PUT to the Xero API.
 */
export async function xeroApiFetch(
  businessId: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<any> {
  const { accessToken, tenantId } = await getValidAccessToken(businessId);
  const url = path.startsWith('http') ? path : `${XERO_API_BASE}${path}`;
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero API ${options.method ?? 'GET'} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}
