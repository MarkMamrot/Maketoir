import { NextResponse } from 'next/server';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { UsersRepository } from '@/lib/db/UsersRepository';
import { execute } from '@/services/MySQLService';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

export async function POST(req: Request) {
  try {
    const { name, company, email, phone, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Email and password are required.' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, error: 'Invalid email address.' }, { status: 400 });
    }

    // Check for duplicate email
    const existing = await UsersRepository.findByEmail(email);
    if (existing) {
      return NextResponse.json({ success: false, error: 'An account with this email already exists.' }, { status: 409 });
    }

    // 1. Create Drive folder + spreadsheet marker for file storage (logo uploads etc.)
    const sheetsService = new GoogleSheetsService();
    const userWorkspaceName = `${company || name} - Marketoir Intelligence`;
    const { spreadsheetId: businessId, folderId } = await sheetsService.createWorkspaceDatabase(
      userWorkspaceName,
      process.env.GOOGLE_USER_DB_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID,
      company || name,
    );

    // 2. Register business + user in MySQL — clean up Drive if this fails
    try {
      await execute(
        `INSERT INTO businesses (business_id, name, drive_folder_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), drive_folder_id = VALUES(drive_folder_id)`,
        [businessId, company || name, folderId ?? null],
      );

      await UsersRepository.create({ email, password, name, company, phone, businessId, role: 'admin' });

      // 3. Store Drive folder ID in config so logo uploads know where to go
      if (folderId) {
        await ConfigRepository.set(businessId, 'FolderID', folderId);
      }
    } catch (dbError: any) {
      // MySQL failed — delete the orphaned Drive spreadsheet and folder
      await sheetsService.deleteFile(businessId).catch(() => {});
      if (folderId) await sheetsService.deleteFile(folderId).catch(() => {});
      throw dbError;
    }

    return NextResponse.json({
      success: true,
      message: 'Registration successful.',
      businessId: businessId,
    });
  } catch (error: any) {
    console.error('Register error:', error);
    return NextResponse.json({ success: false, error: 'Registration failed. Please try again.' }, { status: 500 });
  }
}
