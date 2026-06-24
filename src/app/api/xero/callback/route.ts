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
  // Use the public app URL as the redirect base so Railway's internal proxy
  // hostname (localhost:8080) doesn't leak into the redirect target.
  const appBase = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
    ?? new URL(req.url).origin;

  function redirect(path: string) {
    return NextResponse.redirect(`${appBase}${path}`);
  }

  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Handle user-denied / Xero error
  if (error) {
    return redirect(`/ims?xero=error&reason=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return redirect('/ims?xero=error&reason=missing_params');
  }

  // Retrieve and validate OAuth cookie
  const rawCookie = cookies().get('xero_oauth')?.value;
  if (!rawCookie) {
    return redirect('/ims?xero=error&reason=session_expired');
  }

  let cookieData: { state: string; codeVerifier: string; databaseId: string };
  try {
    cookieData = JSON.parse(rawCookie);
  } catch {
    return redirect('/ims?xero=error&reason=bad_cookie');
  }

  if (cookieData.state !== state) {
    return redirect('/ims?xero=error&reason=state_mismatch');
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
    return redirect('/ims?xero=error&reason=token_exchange');
  }

  // Fetch tenant (organisation) list
  let tenants;
  try {
    tenants = await getConnectedTenants(tokens.access_token);
  } catch (err: any) {
    console.error('[xero/callback] Tenant fetch failed:', err.message);
    return redirect('/ims?xero=error&reason=tenant_fetch');
  }

  const tenant = tenants[0]; // Use first connected tenant
  if (!tenant) {
    return redirect('/ims?xero=error&reason=no_tenant');
  }

  // Persist to DB (tokens encrypted at rest)
  try {
    await saveXeroTokens(databaseId, tokens, tenant.tenantId, tenant.tenantName);
  } catch (err: any) {
    console.error('[xero/callback] saveXeroTokens failed:', err.message);
    return redirect('/ims?xero=error&reason=save_tokens');
  }

  return redirect('/ims?xero=connected');
}
