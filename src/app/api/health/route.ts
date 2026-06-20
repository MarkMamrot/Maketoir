import { NextResponse } from 'next/server';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';

export async function GET() {
  try {
    const sheets = new GoogleSheetsService();
    const email = await sheets.ping();
    return NextResponse.json({ ok: true, google_sheets: email });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
