import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/services/MySQLService';

export async function GET() {
  try {
    const session = cookies().get('marketoir_session');
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
    }

    const user = JSON.parse(session.value);
    const userSpreadsheetId = user.userSpreadsheetId;
    if (!userSpreadsheetId) {
      return NextResponse.json({ success: true, businesses: [] });
    }

    const rows = await query<{ business_id: string; name: string; drive_folder_id: string | null }>(
      'SELECT business_id, name, drive_folder_id FROM businesses WHERE business_id = ? AND deleted_at IS NULL',
      [userSpreadsheetId],
    );

    const businesses = rows.map(r => ({
      name:       r.name       || '',
      databaseId: r.business_id,
      folderId:   r.drive_folder_id || '',
    }));

    return NextResponse.json({ success: true, businesses });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
