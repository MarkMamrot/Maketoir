/**
 * GET /api/website/bulk-edit/history?databaseId=...
 *
 * Returns all rows from the BulkEdit_History tab in the Business_Website
 * spreadsheet, newest first.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';

export async function GET(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  if (!databaseId) {
    return NextResponse.json({ error: 'databaseId required.' }, { status: 400 });
  }

  try {
    const sheets = new GoogleSheetsService();

    const config = await sheets.getData(databaseId, 'Config!A:B');
    const wsRow = (config as string[][]).find(r => r[0] === 'WebsiteSheetId');
    const websiteSheetId = wsRow?.[1];
    if (!websiteSheetId) return NextResponse.json({ history: [] });

    try {
      const data = await sheets.getData(websiteSheetId, 'BulkEdit_History') as string[][];
      if (!data || data.length < 2) return NextResponse.json({ history: [] });

      // Return newest first; skip header row
      const history = data.slice(1).reverse().map(row => ({
        run_at:    row[0] || '',
        fields:    row[1] || '',
        total:     Number(row[2]) || 0,
        succeeded: Number(row[3]) || 0,
        failed:    Number(row[4]) || 0,
        details:   row[5] ? (() => { try { return JSON.parse(row[5]); } catch { return []; } })() : [],
      }));

      return NextResponse.json({ history });
    } catch {
      return NextResponse.json({ history: [] });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
