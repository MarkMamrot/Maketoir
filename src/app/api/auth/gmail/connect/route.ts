/**
 * GET /api/auth/gmail/connect?businessId=xxx
 * Redirects the user to Google's OAuth consent screen using the business's
 * own Google Cloud OAuth client credentials (stored per-business in the
 * connections table — not shared env vars).
 */
import { NextResponse } from 'next/server';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get('businessId') ?? '';
  const appUrl = process.env.APP_URL ?? 'https://solvantis.com.au';
  const returnUrl = `${appUrl}/setup`;

  if (!businessId) {
    return NextResponse.redirect(`${returnUrl}?gmailError=${encodeURIComponent('Missing businessId.')}`);
  }

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
  authUrl.searchParams.set('state',         encodeURIComponent(businessId));

  return NextResponse.redirect(authUrl.toString());
}
