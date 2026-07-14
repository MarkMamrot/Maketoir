import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsExecute } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

/**
 * PUT /api/ims/notifications/read-all — mark all notifications as read for the business.
 */
export async function PUT() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId: string = session.businessId;

  try {
    await imsExecute(
      `UPDATE ims_notifications SET is_read = 1 WHERE business_id = ? AND is_read = 0`,
      [businessId],
    );
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
