import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsExecute } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

/**
 * PUT /api/ims/notifications/[id] — mark a single notification as read.
 * Body: { is_read: boolean }
 */
export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;
  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const isRead = body.is_read !== false ? 1 : 0;

  try {
    await imsExecute(
      `UPDATE ims_notifications SET is_read = ? WHERE id = ? AND business_id = ?`,
      [isRead, id, businessId],
    );
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

/**
 * DELETE /api/ims/notifications/[id] — delete a single notification.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;
  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    await imsExecute(
      `DELETE FROM ims_notifications WHERE id = ? AND business_id = ?`,
      [id, businessId],
    );
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
