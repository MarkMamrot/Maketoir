import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const CLIENT_ID     = process.env.GOOGLE_GMAIL_CLIENT_ID     || process.env.GOOGLE_ADS_CLIENT_ID     || '';
const CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || '';

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Token error: ${data.error} — ${data.error_description ?? ''}`);
  return data.access_token;
}

/**
 * GET /api/sync/gmail?refreshToken=xxx
 * Validates the refresh token by fetching the Gmail profile.
 * Returns { success, email, messagesTotal } on success.
 */
export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const refreshToken = searchParams.get('refreshToken') ?? '';

  if (!refreshToken) {
    return NextResponse.json({ success: false, error: 'refreshToken param is required.' }, { status: 400 });
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.json({ success: false, error: 'GOOGLE_GMAIL_CLIENT_ID / GOOGLE_GMAIL_CLIENT_SECRET not set on server.' }, { status: 500 });
  }

  try {
    const accessToken = await getAccessToken(refreshToken);

    const profileRes = await fetch(`${GMAIL_API}/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = await profileRes.json();

    if (profile.error) {
      return NextResponse.json({ success: false, error: profile.error.message ?? 'Gmail API error' });
    }

    return NextResponse.json({
      success: true,
      email: profile.emailAddress,
      messagesTotal: profile.messagesTotal,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
