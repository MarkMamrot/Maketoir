/**
 * GET /api/auth/gmail/connect?businessId=xxx
 * Redirects the user to Google's OAuth consent screen using the business's
 * own Google Cloud OAuth client credentials (stored per-business in the
 * connections table — not shared env vars).
 */
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';
import { signGmailOAuthState } from '@/lib/customer-service/gmailOAuthState';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
];

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get('businessId') ?? '';
  // Ensure appUrl has https:// — APP_URL may be stored without the scheme.
  const raw = process.env.APP_URL ?? 'solvantis.com.au';
  const appUrl = /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`;
  const returnUrl = `${appUrl}/setup`;

  if (!businessId) {
    return NextResponse.redirect(`${returnUrl}?gmailError=${encodeURIComponent('Missing businessId.')}`);
  }
  const denied = assertBusinessAccess(user, businessId);
  if (denied) return denied;

  // Load the business's own Google OAuth credentials.
  const conn = await ConnectionsRepository.get(businessId).catch(() => null);
  const clientId     = conn?.gmail_client_id ?? '';
  const encSecret    = conn?.gmail_client_secret ?? '';
  let   clientSecret = '';
  try { clientSecret = encSecret ? decrypt(encSecret) : ''; } catch { clientSecret = encSecret; }

  if (!clientId) {
    return NextResponse.redirect(`${returnUrl}?gmailError=${encodeURIComponent('No Google Client ID saved for this business. Enter your Client ID and Secret in the Gmail card first, then Save, then Connect.')}`);
  }
  if (!clientSecret) {
    return NextResponse.redirect(`${returnUrl}?gmailError=${encodeURIComponent('No Google Client Secret saved for this business. Enter your Client Secret in the Gmail card first, then Save, then Connect.')}`);
  }

  const redirectUri = `${appUrl}/api/auth/gmail/callback`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id',     clientId);
  authUrl.searchParams.set('redirect_uri',  redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope',         SCOPES.join(' '));
  authUrl.searchParams.set('access_type',   'offline');
  authUrl.searchParams.set('prompt',        'consent');
  const nonce = randomBytes(24).toString('base64url');
  authUrl.searchParams.set('state', signGmailOAuthState({
    businessId,
    userId: user.userId,
    nonce,
    expiresAt: Date.now() + 10 * 60 * 1000,
  }));

  const redirect = NextResponse.redirect(authUrl.toString());
  redirect.cookies.set('gmail_oauth_nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth/gmail/callback',
    maxAge: 10 * 60,
  });
  return redirect;
}
