/**
 * GET /api/xero/sync-log?databaseId=xxx&limit=50
 *
 * Returns recent Xero sync events for the sync history tab.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { query } from '@/services/MySQLService';

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  const limit = Math.min(Number(searchParams.get('limit') || 50), 200);

  try {
    const rows = await query(
      `SELECT id, sync_type, reference_id, xero_id, status, detail, created_at
       FROM xero_sync_log
       WHERE business_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [databaseId, limit],
    );
    return NextResponse.json({ events: rows });
  } catch (err: any) {
    console.error('[xero/sync-log]', err.message);
    return NextResponse.json({ error: 'Failed to fetch sync log.' }, { status: 500 });
  }
}
