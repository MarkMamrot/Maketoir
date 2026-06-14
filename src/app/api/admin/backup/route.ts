import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { query } from '@/services/MySQLService';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';

const RETAIN_COUNT = 60;

function isAuthorized(authHeader: string, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  try {
    return (
      authHeader.length === expected.length &&
      timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
    );
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.BACKUP_SECRET;
  if (!secret || !isAuthorized(auth, secret)) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const drive = new GoogleSheetsService();

    // Find or create backup folder
    const parentFolderId = process.env.GOOGLE_BACKUP_FOLDER_ID
      ?? process.env.GOOGLE_USER_DB_FOLDER_ID
      ?? process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!parentFolderId) {
      return NextResponse.json({ success: false, error: 'No Google Drive folder configured.' }, { status: 500 });
    }
    const backupFolderId = await drive.findOrCreateFolder('Solvantis-Backups', parentFolderId);

    // Query all tables
    const tables: Record<string, unknown[]> = {};
    const tablesToBackup = [
      'businesses', 'users', 'invites', 'config', 'connections',
      'business_info', 'brand_profile', 'branches', 'suppliers',
      'products', 'stock', 'sales', 'calc_reports', 'yearly_revenue',
      'chats', 'shopify_products', 'shopify_orders', 'marketing_data',
      'bulk_edit_history', 'product_schema', 'product_volumes', 'order_planner_drafts',
    ];

    const counts: Record<string, number> = {};
    const failedTables: string[] = [];
    for (const table of tablesToBackup) {
      try {
        const rows = await query(`SELECT * FROM \`${table}\``);
        tables[table] = rows;
        counts[table] = rows.length;
      } catch {
        counts[table] = -1;
        failedTables.push(table);
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `solvantis-backup-${timestamp}.json`;
    const payload = JSON.stringify({ meta: { timestamp: new Date().toISOString(), counts, failedTables }, tables }, null, 0);

    const fileId = await drive.uploadPrivateFile(payload, filename, 'application/json', backupFolderId);

    // Prune old backups — delete oldest if over limit
    const allFiles = await drive.listFilesInFolder(backupFolderId);
    const backupFiles = allFiles.filter(f => f.name.startsWith('solvantis-backup-'));
    if (backupFiles.length > RETAIN_COUNT) {
      const toDelete = backupFiles.slice(0, backupFiles.length - RETAIN_COUNT);
      await Promise.all(toDelete.map(f => drive.deleteFile(f.id)));
    }

    return NextResponse.json({
      success: true,
      filename,
      fileId,
      counts,
      ...(failedTables.length > 0 && { warning: `Some tables failed to backup: ${failedTables.join(', ')}`, failedTables }),
      retained: Math.min(backupFiles.length, RETAIN_COUNT),
      pruned: Math.max(0, backupFiles.length - RETAIN_COUNT),
    });
  } catch (error: any) {
    console.error('Backup error:', error);
    return NextResponse.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}
