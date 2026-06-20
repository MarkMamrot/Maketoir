import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';

function requireSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(req: Request) {
  const user = requireSession();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const databaseId = searchParams.get('databaseId');

    if (!databaseId || databaseId !== user.businessId) {
      return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
    }

    const sheets = new GoogleSheetsService();

    // Read Marketing Data sheet
    try {
      const data = await sheets.getData(databaseId, 'Marketing_Data!A:C');
      if (!data || data.length < 2) {
        return NextResponse.json({ mission: null });
      }

      // Look for row with "marketing_mission"
      const missionRow = (data as string[][]).find((row: string[]) => row[0] === 'marketing_mission');
      if (!missionRow || !missionRow[2]) {
        return NextResponse.json({ mission: null });
      }

      try {
        const mission = JSON.parse(missionRow[2]);
        return NextResponse.json({ mission });
      } catch {
        return NextResponse.json({ mission: null });
      }
    } catch (e) {
      // Sheet doesn't exist yet
      return NextResponse.json({ mission: null });
    }
  } catch (error: any) {
    console.error('[/api/user/marketing-mission GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = requireSession();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    const body = await req.json();
    const { databaseId, mission } = body;

    if (!databaseId || databaseId !== user.businessId) {
      return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
    }
    if (!mission) {
      return NextResponse.json({ error: 'Missing mission' }, { status: 400 });
    }

    const sheets = new GoogleSheetsService();

    // Ensure Marketing_Data sheet exists with headers
    try {
      const existing = await sheets.getData(databaseId, 'Marketing_Data!A1:C1');
      if (!existing || existing.length === 0) {
        // Create headers
        await sheets.updateData(databaseId, 'Marketing_Data!A1:C1', [
          ['key', 'label', 'data'],
        ]);
      }
    } catch {
      // Sheet doesn't exist, create it with headers
      await sheets.updateData(databaseId, 'Marketing_Data!A1:C1', [
        ['key', 'label', 'data'],
      ]);
    }

    // Find or create marketing_mission row
    try {
      const data = await sheets.getData(databaseId, 'Marketing_Data!A:C');
      const rows = (data as string[][]) || [];
      let missionRowIndex = -1;

      for (let i = 0; i < rows.length; i++) {
        if (rows[i]?.[0] === 'marketing_mission') {
          missionRowIndex = i;
          break;
        }
      }

      const missionData = [
        'marketing_mission',
        'Marketing Mission & Philosophy',
        JSON.stringify(mission),
      ];

      if (missionRowIndex >= 0) {
        // Update existing row
        const rowNum = missionRowIndex + 1;
        await sheets.updateData(databaseId, `Marketing_Data!A${rowNum}:C${rowNum}`, [missionData]);
      } else {
        // Append new row
        await sheets.appendData(databaseId, 'Marketing_Data!A:C', [missionData]);
      }
    } catch (e: any) {
      console.error('Error saving marketing mission:', e);
      return NextResponse.json(
        { error: `Failed to save mission: ${e.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[/api/user/marketing-mission POST]', error);
    return NextResponse.json({ error: 'Failed to save mission.' }, { status: 500 });
  }
}
