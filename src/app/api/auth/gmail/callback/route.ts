/**
 * GET /api/auth/gmail/callback?code=xxx&state=businessId&error=xxx
 * Uses the business's own stored Google OAuth client credentials to exchange
 * the auth code for a refresh token, then saves everything and redirects back.
 */
import { NextResponse } from 'next/server';
import { query } from '@/services/MySQLService';
import { encrypt, decrypt } from '@/lib/encryption';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';

const raw = process.env.APP_URL ?? 'solvantis.com.au';
const APP_URL = /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code       = searchParams.get('code');
  const state      = searchParams.get('state') ?? '';
  const error      = searchParams.get('error');
  const businessId = decodeURIComponent(state);
  const returnUrl  = `${APP_URL}/setup`;

  if (error) {
    const msg = error === 'access_denied' ? 'Gmail access was denied.' : `Google returned: ${error}`;
    return NextResponse.redirect(`${returnUrl}?gmailError=${encodeURIComponent(msg)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${returnUrl}?gmailError=${encodeURIComponent('No authorisation code returned from Google.')}`);
  }

  // Load the business's own OAuth credentials.
  const conn = await ConnectionsRepository.get(businessId).catch(() => null);
  const clientId     = conn?.gmail_client_id ?? '';
  const encSecret    = conn?.gmail_client_secret ?? '';
  let   clientSecret = '';
  try { clientSecret = encSecret ? decrypt(encSecret) : ''; } catch { clientSecret = encSecret; }

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${returnUrl}?gmailError=${encodeURIComponent('OAuth credentials not found for this business. Save your Client ID and Secret first.')}`);
  }

  const redirectUri = `${APP_URL}/api/auth/gmail/callback`;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(`${tokenData.error}: ${tokenData.error_description ?? ''}`);

    const refreshToken = tokenData.refresh_token;
    if (!refreshToken) throw new Error('Google did not return a refresh token. Revoke access at myaccount.google.com/permissions and try again.');

    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    const email   = profile.emailAddress ?? '';

    // Persist email + encrypted refresh token to the connections table.
    await query(
      `INSERT INTO connections (business_id, gmail_email, gmail_refresh_token)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE gmail_email = VALUES(gmail_email), gmail_refresh_token = VALUES(gmail_refresh_token), updated_at = NOW()`,
      [businessId, email, encrypt(refreshToken)],
    ).catch(() => {});

    return NextResponse.redirect(
      `${returnUrl}?gmailSuccess=1&gmailEmail=${encodeURIComponent(email)}&gmailToken=${encodeURIComponent(refreshToken)}&businessId=${encodeURIComponent(businessId)}`,
    );
  } catch (e: any) {
    return NextResponse.redirect(`${returnUrl}?gmailError=${encodeURIComponent(e.message ?? 'OAuth exchange failed')}`);
  }
}
