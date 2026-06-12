/**
 * GET /api/xero/callback?code=xxx&state=xxx
 *
 * Handles Xero OAuth callback. Verifies state, exchanges code for tokens,
 * fetches connected tenant list, saves everything to DB, redirects to setup.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { encrypt } from '@/lib/encryption';

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Handle user-denied / Xero error
  if (error) {
    return NextResponse.redirect(
      new URL(`/setup?tab=connections&xero=error&reason=${encodeURIComponent(error)}`, req.url),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/setup?tab=connections&xero=error&reason=missing_params', req.url));
  }

  // Retrieve and validate OAuth cookie
  const rawCookie = cookies().get('xero_oauth')?.value;
  if (!rawCookie) {
    return NextResponse.redirect(new URL('/setup?tab=connections&xero=error&reason=session_expired', req.url));
  }

  let cookieData: { state: string; codeVerifier: string; databaseId: string };
  try {
    cookieData = JSON.parse(rawCookie);
  } catch {
    return NextResponse.redirect(new URL('/setup?tab=connections&xero=error&reason=bad_cookie', req.url));
  }

  if (cookieData.state !== state) {
    return NextResponse.redirect(new URL('/setup?tab=connections&xero=error&reason=state_mismatch', req.url));
  }

  // Clear the OAuth cookie
  cookies().delete('xero_oauth');

  const { codeVerifier, databaseId } = cookieData;

  // App-level credentials from .env
  const clientId   = process.env.XERO_CLIENT_ID;
  const redirectUri = process.env.XERO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.redirect(new URL('/setup?tab=connections&xero=error&reason=server_config', req.url));
  }

  // Exchange code for tokens (using PKCE — no client secret)
  const tokenRes = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      client_id:     clientId,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error('[xero/callback] Token exchange failed:', tokenRes.status, body);
    return NextResponse.redirect(new URL('/setup?tab=connections&xero=error&reason=token_exchange', req.url));
  }

  const tokens = await tokenRes.json() as {
    access_token:  string;
    refresh_token: string;
    expires_in:    number;
    token_type:    string;
  };

  // Fetch tenant (organisation) list
  const tenantsRes = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
  });

  if (!tenantsRes.ok) {
    const body = await tenantsRes.text();
    console.error('[xero/callback] Tenant fetch failed:', tenantsRes.status, body);
    return NextResponse.redirect(new URL('/setup?tab=connections&xero=error&reason=tenant_fetch', req.url));
  }

  const tenants = await tenantsRes.json() as Array<{ tenantId: string; tenantName: string }>;
  const tenant = tenants[0]; // Use first connected tenant
  if (!tenant) {
    return NextResponse.redirect(new URL('/setup?tab=connections&xero=error&reason=no_tenant', req.url));
  }

  // Persist to DB (tokens encrypted at rest)
  const expiryMs = Date.now() + tokens.expires_in * 1000;
  await ConnectionsRepository.upsert(databaseId, {
    xero_tenant_id:    tenant.tenantId,
    xero_tenant_name:  tenant.tenantName,
    xero_access_token:  encrypt(tokens.access_token),
    xero_refresh_token: encrypt(tokens.refresh_token),
    xero_token_expiry:  String(expiryMs),
  });

  return NextResponse.redirect(
    new URL('/setup?tab=connections&xero=connected', req.url),
  );
}
