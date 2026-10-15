import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import {
  assertOptionalIntegrationEnabled,
  isIntegrationDisabledError,
} from '@/lib/ims/integrationAvailability';

async function testConnection(adAccountId: string, accessToken: string) {
  try {
    const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const response = await fetch(`https://graph.facebook.com/v19.0/${accountId}?fields=id,name&access_token=${accessToken}`);
    const data = await response.json();
    if (!response.ok || data.error) {
      return NextResponse.json({ success: false, error: 'Meta connection failed. Check the saved credentials.' }, { status: 401 });
    }
    return NextResponse.json({ success: true, message: 'Meta Ads connection successful.' });
  } catch {
    return NextResponse.json({ success: false, error: 'Meta connection failed.' }, { status: 502 });
  }
}

async function testForBusiness(
  businessId: string,
  suppliedAccountId?: unknown,
  suppliedAccessToken?: unknown,
) {
  try {
    await assertOptionalIntegrationEnabled(businessId, 'meta');
    const hasAccountId = typeof suppliedAccountId === 'string' && suppliedAccountId.trim().length > 0;
    const hasToken = typeof suppliedAccessToken === 'string' && suppliedAccessToken.trim().length > 0;
    if (hasAccountId !== hasToken) {
      return NextResponse.json({ success: false, error: 'Provide both adAccountId and accessToken, or omit both to test saved credentials.' }, { status: 400 });
    }
    if (hasAccountId && hasToken) {
      return testConnection(String(suppliedAccountId).trim(), String(suppliedAccessToken).trim());
    }
    const connection = await ConnectionsRepository.get(businessId);
    if (!connection?.meta_ad_account_id || !connection.meta_access_token) {
      return NextResponse.json({ success: false, error: 'Meta Ads is not configured.' }, { status: 400 });
    }
    let accessToken = connection.meta_access_token;
    try { accessToken = decrypt(accessToken); } catch { /* legacy plaintext */ }
    return testConnection(connection.meta_ad_account_id, accessToken);
  } catch (error) {
    if (isIntegrationDisabledError(error)) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: 'Meta integration availability is not ready.' }, { status: 503 });
  }
}

/** POST { adAccountId?, accessToken? }; omit both to test saved credentials. */
export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { adAccountId?: unknown; accessToken?: unknown };
  return testForBusiness(session.businessId, body.adAccountId, body.accessToken);
}

/** Backward-compatible GET. Prefer POST so draft tokens do not enter URLs. */
export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  return testForBusiness(session.businessId, params.get('adAccountId'), params.get('accessToken'));
}
