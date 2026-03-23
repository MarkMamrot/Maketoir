import { NextResponse } from 'next/server';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';

/**
 * Phase 1: Database Setup via API
 * 
 * This API endpoint takes a Workspace/User Name and an optional Shared Drive Folder ID.
 * It will use the Google Drive API to dynamically CREATE a brand new, empty Spreadsheet
 * specifically for this user, and then provision it with the Marketoir tabs and columns.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { workspaceName, folderId } = body;

    if (!workspaceName) {
      return NextResponse.json(
        { success: false, error: 'workspaceName is required in the request body.' },
        { status: 400 }
      );
    }

    const sheetsService = new GoogleSheetsService();
    // This creates the file in Google Drive, saves the ID internally, and runs the schema initialization!
    const newSpreadsheetId = await sheetsService.createWorkspaceDatabase(workspaceName, folderId);

    return NextResponse.json({
      success: true,
      message: `Google Sheets database created successfully for ${workspaceName}.`,
      spreadsheetId: newSpreadsheetId // The App will save this ID to the User's profile
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

