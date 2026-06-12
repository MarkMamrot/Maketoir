/**
 * GET /api/xero/connect?databaseId=xxx
 *
 * Initiates Xero OAuth 2.0 PKCE flow. Generates state + code_verifier,
 * stores them in a short-lived cookie, then redirects to Xero's auth page.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'crypto';

const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';

const XERO_SCOPES = [
  'openid',
  'profile',
  'email',
  'accounting.invoices',
  'accounting.payments',
  'accounting.contacts',
  'accounting.settings',
  'offline_access',
].join(' ');

function requireSession() {
  const session = cookies().get('marketoir_session');
  if (!session) return null;
  try { return JSON.parse(session.value); } catch { return null; }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function GET(req: Request) {
  const user = requireSession();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId) {
    return NextResponse.json({ error: 'databaseId is required.' }, { status: 400 });
  }

  // Load credentials from .env (app-level config — shared across all businesses)
  const clientId   = process.env.XERO_CLIENT_ID;
  const redirectUri = process.env.XERO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'XERO_CLIENT_ID and XERO_REDIRECT_URI must be set in .env' },
      { status: 500 },
    );
  }

  // Generate PKCE values
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  const state = base64url(randomBytes(16));

  // Store state + verifier + businessId in a short-lived cookie (10 min)
  const xeroOAuthCookie = JSON.stringify({ state, codeVerifier, databaseId });
  cookies().set('xero_oauth', xeroOAuthCookie, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: XERO_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `${XERO_AUTH_URL}?${params.toString()}`;
  console.log('[xero/connect] client_id:', clientId, '| redirect_uri:', redirectUri);
  return NextResponse.redirect(authUrl);
}
