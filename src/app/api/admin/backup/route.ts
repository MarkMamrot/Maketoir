import { NextResponse } from 'next/server';
import { query } from '@/services/MySQLService';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';

const RETAIN_COUNT = 60; // keep last 60 backups (30 days at twice-daily)

export async function POST(req: Request) {
  // Validate secret
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.BACKUP_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
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
    for (const table of tablesToBackup) {
      try {
        const rows = await query(`SELECT * FROM \`${table}\``);
        tables[table] = rows;
        counts[table] = rows.length;
      } catch {
        // Table might not exist yet — skip gracefully
        counts[table] = -1;
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `solvantis-backup-${timestamp}.json`;
    const payload = JSON.stringify({ meta: { timestamp: new Date().toISOString(), counts }, tables }, null, 0);

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
      retained: Math.min(backupFiles.length, RETAIN_COUNT),
      pruned: Math.max(0, backupFiles.length - RETAIN_COUNT),
    });
  } catch (error: any) {
    console.error('Backup error:', error);
    return NextResponse.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}
