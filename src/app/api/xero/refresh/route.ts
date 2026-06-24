/**
 * POST /api/xero/refresh
 * Body: { databaseId: string }
 *
 * Attempts to obtain a valid Xero access token (refreshing if the stored one is expired).
 * Returns the new expiry so the UI can confirm the connection is live.
 *
 * This is safe to call as a "Test Connection" check — if the refresh token has expired
 * (Xero invalidates them after 60 days of inactivity), this will return an error and
 * the user knows they need to reconnect via OAuth.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { getValidAccessToken } from '@/services/XeroService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { databaseId } = await req.json();
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  try {
    // This call refreshes the access token if expired (using the stored refresh token).
    // Throws if the refresh token itself has expired or the connection is broken.
    await getValidAccessToken(databaseId);

    // Read back the updated expiry from DB
    const row = await ConnectionsRepository.get(databaseId);
    const newExpiry = row?.xero_token_expiry ? Number(row.xero_token_expiry) : null;

    return NextResponse.json({ success: true, newExpiry });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message ?? 'Token refresh failed' },
      { status: 400 },
    );
  }
}
