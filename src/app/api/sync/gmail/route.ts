import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import {
  assertOptionalIntegrationEnabled,
  isIntegrationDisabledError,
} from '@/lib/ims/integrationAvailability';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const ENV_CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID || '';
const ENV_CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || '';

async function getAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('Gmail token refresh failed.');
  return data.access_token;
}

async function testConnection(businessId: string, suppliedRefreshToken?: unknown) {
  try {
    await assertOptionalIntegrationEnabled(businessId, 'gmail');
    const connection = await ConnectionsRepository.get(businessId);
    let refreshToken = typeof suppliedRefreshToken === 'string' ? suppliedRefreshToken.trim() : '';
    if (!refreshToken && connection?.gmail_refresh_token) {
      try { refreshToken = decrypt(connection.gmail_refresh_token); }
      catch { refreshToken = connection.gmail_refresh_token; }
    }
    let clientSecret = connection?.gmail_client_secret ?? ENV_CLIENT_SECRET;
    if (connection?.gmail_client_secret) {
      try { clientSecret = decrypt(connection.gmail_client_secret); }
      catch { /* legacy plaintext */ }
    }
    const clientId = connection?.gmail_client_id || ENV_CLIENT_ID;
    if (!refreshToken) {
      return NextResponse.json({ success: false, error: 'Gmail refresh token is not configured.' }, { status: 400 });
    }
    if (!clientId || !clientSecret) {
      return NextResponse.json({ success: false, error: 'Gmail OAuth client credentials are not configured.' }, { status: 400 });
    }

    const accessToken = await getAccessToken(refreshToken, clientId, clientSecret);
    const response = await fetch(`${GMAIL_API}/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = await response.json();
    if (!response.ok || profile.error) throw new Error('Gmail profile lookup failed.');

    return NextResponse.json({
      success: true,
      email: profile.emailAddress,
      messagesTotal: profile.messagesTotal,
    });
  } catch (error) {
    if (isIntegrationDisabledError(error)) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: 'Gmail connection could not be verified.' }, { status: 502 });
  }
}

/** POST { refreshToken? }; omit the draft token to test saved business credentials. */
export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { refreshToken?: unknown };
  return testConnection(session.businessId, body.refreshToken);
}

/** Backward-compatible GET. Prefer POST so draft tokens do not enter URLs. */
export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  const refreshToken = new URL(request.url).searchParams.get('refreshToken') ?? undefined;
  return testConnection(session.businessId, refreshToken);
}
