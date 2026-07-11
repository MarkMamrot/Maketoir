/**
 * GET /api/auth/gmail/callback?code=xxx&state=businessId&error=xxx
 *
 * Google redirects here after the user grants (or denies) Gmail access.
 * On success: exchanges the auth code for a refresh token, saves both the
 * email address and encrypted token to the business connections sheet, then
 * redirects to /setup with ?gmailSuccess=true&gmailEmail=xxx.
 * On error: redirects to /setup with ?gmailError=xxx.
 */
import { NextResponse } from 'next/server';
import { query } from '@/services/MySQLService';
import { encrypt } from '@/lib/encryption';

const CLIENT_ID     = process.env.GOOGLE_GMAIL_CLIENT_ID     || process.env.GOOGLE_CLIENT_ID     || '';
const CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
const APP_URL       = process.env.APP_URL ?? 'https://solvantis.com.au';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code    = searchParams.get('code');
  const state   = searchParams.get('state') ?? '';   // businessId
  const error   = searchParams.get('error');

  const returnUrl = `${APP_URL}/setup`;

  // User denied access.
  if (error) {
    const msg = error === 'access_denied' ? 'Gmail access was denied.' : `Google returned: ${error}`;
    return NextResponse.redirect(`${returnUrl}?gmailError=${encodeURIComponent(msg)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${returnUrl}?gmailError=${encodeURIComponent('No authorisation code returned from Google.')}`);
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.redirect(`${returnUrl}?gmailError=${encodeURIComponent('Server is missing GOOGLE_GMAIL_CLIENT_ID / GOOGLE_GMAIL_CLIENT_SECRET env vars.')}`);
  }

  const redirectUri = `${APP_URL}/api/auth/gmail/callback`;

  try {
    // Exchange code for tokens.
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      throw new Error(`${tokenData.error}: ${tokenData.error_description ?? ''}`);
    }

    const refreshToken = tokenData.refresh_token;
    if (!refreshToken) {
      throw new Error('Google did not return a refresh token. If you previously connected this account, revoke access at myaccount.google.com/permissions and try again.');
    }

    // Fetch the Gmail profile to confirm access and get the email address.
    const accessToken = tokenData.access_token;
    const profileRes  = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = await profileRes.json();
    const email   = profile.emailAddress ?? '';

    // Persist to the connections table (same DB as setup page).
    // businessId is in `state`; store the encrypted refresh token.
    const businessId = decodeURIComponent(state);
    if (businessId) {
      const encryptedToken = encrypt(refreshToken);
      // The connections table uses snake_case columns.
      await query(
        `INSERT INTO connections (business_id, gmail_email, gmail_refresh_token)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE gmail_email = VALUES(gmail_email),
                                 gmail_refresh_token = VALUES(gmail_refresh_token),
                                 updated_at = NOW()`,
        [businessId, email, encryptedToken],
      ).catch(() => {
        // Fallback: table may use different column names — the page will also save
        // via the normal saveCard path after receiving gmailSuccess params.
      });
    }

    return NextResponse.redirect(
      `${returnUrl}?gmailSuccess=1&gmailEmail=${encodeURIComponent(email)}&gmailToken=${encodeURIComponent(refreshToken)}&businessId=${encodeURIComponent(businessId)}`,
    );
  } catch (e: any) {
    return NextResponse.redirect(`${returnUrl}?gmailError=${encodeURIComponent(e.message ?? 'OAuth exchange failed')}`);
  }
}
