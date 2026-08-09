import { NextResponse } from 'next/server';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { UsersRepository } from '@/lib/db/UsersRepository';
import { execute } from '@/services/MySQLService';
import { ConfigRepository } from '@/lib/db/ConfigRepository';
import { getPasswordValidation } from '@/lib/auth/passwordPolicy';
import {
  cleanupFailedBusinessProvision,
  ImsProvisioningError,
  provisionBusinessIms,
} from '@/lib/ims/provisionBusiness';
import { BusinessInfoRepository } from '@/lib/db/BusinessInfoRepository';
import { imsExecute } from '@/services/IMSMySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(req: Request) {
  try {
    const { name, company, email, phone, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Email and password are required.' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, error: 'Invalid email address.' }, { status: 400 });
    }
    const passwordValidation = getPasswordValidation(password);
    if (!passwordValidation.isValid) {
      return NextResponse.json({ success: false, error: passwordValidation.message }, { status: 400 });
    }

    // Check for duplicate email
    const existing = await UsersRepository.findByEmail(email);
    if (existing) {
      return NextResponse.json({ success: false, error: 'An account with this email already exists.' }, { status: 409 });
    }

    // 1. Create Drive folder + spreadsheet marker for file storage (logo uploads etc.)
    const sheetsService = new GoogleSheetsService();
    const businessName = company || name || 'Business';
    const userWorkspaceName = `${businessName} - Marketoir Intelligence`;
    const { spreadsheetId: businessId, folderId } = await sheetsService.createWorkspaceDatabase(
      userWorkspaceName,
      process.env.GOOGLE_USER_DB_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID,
      businessName,
    );

    // 2. Register business + user in MySQL — clean up Drive if this fails
    let businessCreated = false;
    let imsDbName: string | null = null;
    let schemaCreated = false;
    try {
      await execute(
        `INSERT INTO businesses (business_id, name, drive_folder_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), drive_folder_id = VALUES(drive_folder_id)`,
        [businessId, businessName, folderId ?? null],
      );
      businessCreated = true;

      const ims = await provisionBusinessIms({ businessId, businessName });
      imsDbName = ims.imsDbName;
      schemaCreated = ims.schemaCreated;

      await Promise.all([
        BusinessInfoRepository.upsert(businessId, { brand_name: businessName }),
        imsExecute(
          `INSERT INTO ims_settings (business_id, \`key\`, value)
           VALUES (?, 'business_name', ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`,
          [businessId, businessName],
          ims.imsDbName,
        ),
      ]);

      await UsersRepository.create({ email, password, name, company: businessName, phone, businessId, role: 'admin', tier: 'Admin' });

      // 3. Store Drive folder ID in config so logo uploads know where to go
      if (folderId) {
        await ConfigRepository.set(businessId, 'FolderID', folderId);
      }
    } catch (dbError: unknown) {
      if (dbError instanceof ImsProvisioningError) {
        imsDbName = dbError.imsDbName;
        schemaCreated = dbError.schemaCreated;
      }
      const cleanup = await cleanupFailedBusinessProvision({
        businessId,
        imsDbName,
        schemaCreated,
        businessCreated,
      });
      await sheetsService.deleteFile(businessId).catch(() => {});
      if (folderId) await sheetsService.deleteFile(folderId).catch(() => {});
      await reportRuntimeIssue({
        businessId,
        source: 'registration',
        operation: cleanup.errors.length > 0 ? 'provision_cleanup_failed' : 'provision_failed',
        severity: cleanup.errors.length > 0 ? 'critical' : 'error',
        title: cleanup.errors.length > 0
          ? 'New business provisioning cleanup failed'
          : 'New business provisioning failed',
        error: dbError,
        context: {
          imsDbName,
          schemaCreated,
          businessCreated,
          schemaDropped: cleanup.schemaDropped,
          businessDeleted: cleanup.businessDeleted,
          cleanupErrors: cleanup.errors,
        },
      });
      throw dbError;
    }

    return NextResponse.json({
      success: true,
      message: 'Registration successful.',
      businessId: businessId,
    });
  } catch (error: unknown) {
    console.error('Register error:', error);
    return NextResponse.json({ success: false, error: 'Registration failed. Please try again.' }, { status: 500 });
  }
}
