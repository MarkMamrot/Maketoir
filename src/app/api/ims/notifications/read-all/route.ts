import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsExecute } from '@/services/IMSMySQLService';


/**
 * PUT /api/ims/notifications/read-all — mark all notifications as read for the business.
 */
export async function PUT() {
  const session = await getImsSession();
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
