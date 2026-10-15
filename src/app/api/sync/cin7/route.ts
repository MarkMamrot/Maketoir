import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { getCin7Credentials } from '@/lib/cin7Helpers';
import {
  assertOptionalIntegrationEnabled,
  isIntegrationDisabledError,
} from '@/lib/ims/integrationAvailability';

async function testConnection(accountId: string, apiKey: string) {
  try {
    const auth = Buffer.from(`${accountId}:${apiKey}`).toString('base64');
    const res = await fetch('https://api.cin7.com/api/v1/Products?rows=1', {
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Cin7 returned HTTP ${res.status}`);
    }
    return NextResponse.json({ success: true, message: 'Cin7 connection successful.' });
  } catch {
    return NextResponse.json({ success: false, error: 'Cin7 connection failed. Check credentials.' }, { status: 400 });
  }
}

async function testForBusiness(
  businessId: string,
  suppliedAccountId?: unknown,
  suppliedApiKey?: unknown,
) {
  try {
    await assertOptionalIntegrationEnabled(businessId, 'cin7');
    const hasAccount = typeof suppliedAccountId === 'string' && suppliedAccountId.trim().length > 0;
    const hasKey = typeof suppliedApiKey === 'string' && suppliedApiKey.trim().length > 0;
    if (hasAccount && hasKey) return testConnection(String(suppliedAccountId).trim(), String(suppliedApiKey).trim());
    const credentials = await getCin7Credentials(businessId);
    return testConnection(
      hasAccount ? String(suppliedAccountId).trim() : credentials.accountId,
      hasKey ? String(suppliedApiKey).trim() : credentials.apiKey,
    );
  } catch (error) {
    if (isIntegrationDisabledError(error)) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Cin7 credentials are not configured.',
    }, { status: 400 });
  }
}

/** POST { accountId?, apiKey? }; omit both to test saved credentials. */
export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { accountId?: unknown; apiKey?: unknown };
  return testForBusiness(session.businessId, body.accountId, body.apiKey);
}

/** Backward-compatible GET. Prefer POST so draft credentials do not enter URLs. */
export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const accountId = params.get('accountId');
  const apiKey = params.get('apiKey');
  return testForBusiness(session.businessId, accountId || undefined, apiKey || undefined);
}
