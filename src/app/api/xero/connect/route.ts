/**
 * GET /api/xero/connect?databaseId=xxx
 *
 * Initiates Xero OAuth 2.0 PKCE flow. Generates state + code_verifier,
 * stores them in a short-lived cookie, then redirects to Xero's auth page.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { generateCodeVerifier, generateCodeChallenge, buildAuthorizeUrl, isXeroConfigured } from '@/services/XeroService';
import { randomBytes } from 'crypto';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function requestOrigin(req: Request): string {
  const xfProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const xfHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (xfProto && xfHost) return `${xfProto}://${xfHost}`;
  return new URL(req.url).origin;
}

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  const debug = searchParams.get('debug') === '1';
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  if (!isXeroConfigured()) {
    return NextResponse.json(
      { error: 'XERO_CLIENT_ID, XERO_CLIENT_SECRET, and XERO_REDIRECT_URI must be set in .env' },
      { status: 500 },
    );
  }

  // Generate PKCE values
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = base64url(randomBytes(16));

  // Store state + verifier + businessId + caller origin in a short-lived cookie (10 min)
  const xeroOAuthCookie = JSON.stringify({
    state,
    codeVerifier,
    databaseId,
    returnBase: requestOrigin(req),
  });
  cookies().set('xero_oauth', xeroOAuthCookie, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  const authUrl = buildAuthorizeUrl(state, codeChallenge);

  if (debug) {
    const parsed = new URL(authUrl);
    return NextResponse.json({
      success: true,
      appOrigin: requestOrigin(req),
      redirectUriSent: parsed.searchParams.get('redirect_uri'),
      scopeSent: parsed.searchParams.get('scope'),
      authUrl,
    });
  }

  return NextResponse.redirect(authUrl);
}
