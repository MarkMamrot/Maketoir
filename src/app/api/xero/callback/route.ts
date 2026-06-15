/**
 * GET /api/xero/callback?code=xxx&state=xxx
 *
 * Handles Xero OAuth callback. Verifies state, exchanges code for tokens,
 * fetches connected tenant list, saves everything to DB, redirects to setup.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCodeForTokens, getConnectedTenants, saveXeroTokens } from '@/services/XeroService';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Handle user-denied / Xero error
  if (error) {
    return NextResponse.redirect(
      new URL(`/ims?xero=error&reason=${encodeURIComponent(error)}`, req.url),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/ims?xero=error&reason=missing_params', req.url));
  }

  // Retrieve and validate OAuth cookie
  const rawCookie = cookies().get('xero_oauth')?.value;
  if (!rawCookie) {
    return NextResponse.redirect(new URL('/ims?xero=error&reason=session_expired', req.url));
  }

  let cookieData: { state: string; codeVerifier: string; databaseId: string };
  try {
    cookieData = JSON.parse(rawCookie);
  } catch {
    return NextResponse.redirect(new URL('/ims?xero=error&reason=bad_cookie', req.url));
  }

  if (cookieData.state !== state) {
    return NextResponse.redirect(new URL('/ims?xero=error&reason=state_mismatch', req.url));
  }

  // Clear the OAuth cookie
  cookies().delete('xero_oauth');

  const { codeVerifier, databaseId } = cookieData;

  // Exchange code for tokens via XeroService (uses PKCE — no client secret)
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, codeVerifier);
  } catch (err: any) {
    console.error('[xero/callback] Token exchange failed:', err.message);
    return NextResponse.redirect(new URL('/ims?xero=error&reason=token_exchange', req.url));
  }

  // Fetch tenant (organisation) list
  let tenants;
  try {
    tenants = await getConnectedTenants(tokens.access_token);
  } catch (err: any) {
    console.error('[xero/callback] Tenant fetch failed:', err.message);
    return NextResponse.redirect(new URL('/ims?xero=error&reason=tenant_fetch', req.url));
  }

  const tenant = tenants[0]; // Use first connected tenant
  if (!tenant) {
    return NextResponse.redirect(new URL('/ims?xero=error&reason=no_tenant', req.url));
  }

  // Persist to DB (tokens encrypted at rest)
  await saveXeroTokens(databaseId, tokens, tenant.tenantId, tenant.tenantName);

  return NextResponse.redirect(
    new URL('/ims?xero=connected', req.url),
  );
}
