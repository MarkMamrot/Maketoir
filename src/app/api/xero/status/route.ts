/**
 * GET /api/xero/status?databaseId=xxx
 *
 * Returns whether Xero is connected for a given business,
 * plus the tenant name and token expiry timestamp.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';

function requireSession() {
  const session = cookies().get('marketoir_session');
  if (!session) return null;
  try { return JSON.parse(session.value); } catch { return null; }
}

export async function GET(req: Request) {
  const user = requireSession();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId) {
    return NextResponse.json({ error: 'databaseId is required.' }, { status: 400 });
  }

  try {
    const row = await ConnectionsRepository.get(databaseId);
    const connected = !!(row?.xero_tenant_id && row?.xero_refresh_token);
    return NextResponse.json({
      connected,
      tenantName:  connected ? row!.xero_tenant_name  ?? null : null,
      tenantId:    connected ? row!.xero_tenant_id    ?? null : null,
      tokenExpiry: connected ? Number(row!.xero_token_expiry ?? 0) : null,
      envConfigured: !!(process.env.XERO_CLIENT_ID && process.env.XERO_REDIRECT_URI),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
