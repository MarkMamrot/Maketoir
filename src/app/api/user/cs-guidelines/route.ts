import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';

const KEY_GUIDELINES = 'CSGuidelines';
const KEY_HELPER_EMAIL = 'CSHelperEmail';

function requireSession() {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return null;
  try { return JSON.parse(session.value); } catch { return null; }
}

async function upsertConfigRow(sheets: GoogleSheetsService, databaseId: string, rows: string[][], key: string, value: string) {
  const rowIndex = rows?.findIndex(r => r[0] === key) ?? -1;
  if (rowIndex >= 1) {
    await sheets.updateData(databaseId, `Config!A${rowIndex + 1}:B${rowIndex + 1}`, [[key, value]]);
  } else {
    const nextRow = (rows?.length ?? 0) + 1;
    await sheets.updateData(databaseId, `Config!A${nextRow}:B${nextRow}`, [[key, value]]);
    // Re-read so subsequent upserts use an accurate row count
    rows.push([key, value]);
  }
}

export async function GET(req: Request) {
  const _sess = requireSession();
  if (!_sess) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId') || '';
  if (!databaseId || databaseId !== _sess.businessId) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });

  const sheets = new GoogleSheetsService();
  try {
    const rows = (await sheets.getData(databaseId, 'Config!A:B')) as string[][];
    const guidelines = rows?.find(r => r[0] === KEY_GUIDELINES)?.[1] ?? '';
    const helperEmail = rows?.find(r => r[0] === KEY_HELPER_EMAIL)?.[1] ?? '';
    return NextResponse.json({ guidelines, helperEmail });
  } catch {
    return NextResponse.json({ guidelines: '', helperEmail: '' });
  }
}

export async function POST(req: Request) {
  const _sess = requireSession();
  if (!_sess) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const { databaseId, guidelines, helperEmail } = await req.json();
  if (!databaseId || databaseId !== _sess.businessId) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });

  const sheets = new GoogleSheetsService();
  try {
    const rows = (await sheets.getData(databaseId, 'Config!A:B')) as string[][];
    await upsertConfigRow(sheets, databaseId, rows, KEY_GUIDELINES, guidelines ?? '');
    await upsertConfigRow(sheets, databaseId, rows, KEY_HELPER_EMAIL, helperEmail ?? '');
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Failed to save guidelines.' }, { status: 500 });
  }
}
