/**
 * POST /api/xero/disconnect
 * Body: { databaseId: string }
 *
 * Revokes the Xero token (best-effort) and clears all Xero credentials from DB.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';

const XERO_REVOKE_URL = 'https://identity.xero.com/connect/revocation';

function requireSession() {
  const session = cookies().get('marketoir_session');
  if (!session) return null;
  try { return JSON.parse(session.value); } catch { return null; }
}

export async function POST(req: Request) {
  const user = requireSession();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { databaseId } = await req.json();
  if (!databaseId) {
    return NextResponse.json({ error: 'databaseId is required.' }, { status: 400 });
  }

  try {
    // Best-effort revoke at Xero
    const row = await ConnectionsRepository.get(databaseId);
    if (row?.xero_refresh_token) {
    const clientId = row?.xero_client_id || process.env.XERO_CLIENT_ID;
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
    await ConnectionsRepository.upsert(databaseId, {
      xero_tenant_id:    null,
      xero_tenant_name:  null,
      xero_access_token:  null,
      xero_refresh_token: null,
      xero_token_expiry:  null,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
