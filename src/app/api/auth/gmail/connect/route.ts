/**
 * GET /api/auth/gmail/connect?businessId=xxx
 * Redirects the user to Google's OAuth consent screen to grant Gmail access.
 * The businessId is encoded in the OAuth state parameter so the callback
 * knows which business to save the token for.
 */
import { NextResponse } from 'next/server';

const CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

export function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get('businessId') ?? '';

  if (!CLIENT_ID) {
    return NextResponse.json({ error: 'GOOGLE_GMAIL_CLIENT_ID is not configured in the server environment.' }, { status: 500 });
  }

  const redirectUri = `${process.env.APP_URL ?? ''}/api/auth/gmail/callback`;
  const state = encodeURIComponent(businessId);

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id',     CLIENT_ID);
  authUrl.searchParams.set('redirect_uri',  redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope',         SCOPES.join(' '));
  authUrl.searchParams.set('access_type',   'offline');
  authUrl.searchParams.set('prompt',        'consent');  // always return refresh_token
  authUrl.searchParams.set('state',         state);

  return NextResponse.redirect(authUrl.toString());
}
