import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';


/**
 * GET /api/ims/notifications
 * Returns up to 100 most recent notifications for the business, plus unread count.
 * Query param: ?unread_only=1 to filter to unread only.
 */
export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get('unread_only') === '1';

  try {
    const [notifications, countRows] = await Promise.all([
      imsQuery<{
        id: number;
        type: string;
        source: string;
        title: string;
        message: string;
        detail: string | null;
        is_read: number;
        created_at: string;
      }>(
        `SELECT id, type, source, title, message, detail, is_read, created_at
           FROM ims_notifications
          WHERE business_id = ?
            ${unreadOnly ? 'AND is_read = 0' : ''}
          ORDER BY created_at DESC
          LIMIT 100`,
        [businessId],
      ),
      imsQuery<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM ims_notifications WHERE business_id = ? AND is_read = 0`,
        [businessId],
      ),
    ]);

    const unreadCount = countRows[0]?.cnt ?? 0;

    // Parse detail JSON if present
    const items = notifications.map(n => ({
      ...n,
      is_read: Boolean(n.is_read),
      detail: n.detail ? (() => { try { return JSON.parse(n.detail as string); } catch { return n.detail; } })() : null,
    }));

    return NextResponse.json({ success: true, notifications: items, unreadCount });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * DELETE /api/ims/notifications — delete all notifications for the business.
 * Body: {} (clears all), or use per-ID route for single.
 */
export async function DELETE(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;

  try {
    await imsExecute(
      `DELETE FROM ims_notifications WHERE business_id = ?`,
      [businessId],
    );
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
