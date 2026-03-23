import { NextResponse } from 'next/server';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';

/**
 * Phase 1: Database Setup
 * 
 * This API endpoint takes a target Google Sheet ID and automatically
 * provisions it with the necessary tabs and column headers to act
 * as the core "Database" for Marketoir.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { spreadsheetId } = body;

    if (!spreadsheetId) {
      return NextResponse.json(
        { success: false, error: 'spreadsheetId is required in the request body.' },
        { status: 400 }
      );
    }

    const sheets = new GoogleSheetsService(spreadsheetId);
    await sheets.initializeSchema();

    return NextResponse.json({
      success: true,
      message: 'Google Sheets database schema (Tabs & Headers) initialized successfully.',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
