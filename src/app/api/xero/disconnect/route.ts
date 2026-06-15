/**
 * POST /api/xero/disconnect
 * Body: { databaseId: string }
 *
 * Revokes the Xero token (best-effort) and clears all Xero credentials from DB.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { clearXeroTokens } from '@/services/XeroService';
import { decrypt } from '@/lib/encryption';

const XERO_REVOKE_URL = 'https://identity.xero.com/connect/revocation';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { databaseId } = await req.json();
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  try {
    // Best-effort revoke at Xero
    const row = await ConnectionsRepository.get(databaseId);
    if (row?.xero_refresh_token) {
      const clientId = process.env.XERO_CLIENT_ID;
      if (clientId) {
        const refreshToken = decrypt(row.xero_refresh_token);
        await fetch(XERO_REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token:       refreshToken,
            client_id:   clientId,
            token_type_hint: 'refresh_token',
          }).toString(),
        }).catch(() => { /* revoke failure is non-fatal */ });
      }
    }

    // Clear Xero fields from DB
    await clearXeroTokens(databaseId);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to disconnect.' }, { status: 500 });
  }
}
