/**
 * GET /api/xero/status?databaseId=xxx
 *
 * Returns whether Xero is connected for a given business,
 * plus the tenant name and token expiry timestamp.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { isXeroConfigured } from '@/services/XeroService';

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  try {
    const row = await ConnectionsRepository.get(databaseId!);
    const connected = !!(row?.xero_tenant_id && row?.xero_refresh_token);
    return NextResponse.json({
      connected,
      tenantName:  connected ? row!.xero_tenant_name  ?? null : null,
      tenantId:    connected ? row!.xero_tenant_id    ?? null : null,
      tokenExpiry: connected && row!.xero_token_expiry ? new Date(row!.xero_token_expiry).getTime() : null,
      envConfigured: isXeroConfigured(),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch Xero status.' }, { status: 500 });
  }
}
