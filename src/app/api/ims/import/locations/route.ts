import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { getImportSession, getLegacyConn, makeSSEStream } from '../_helpers';

export async function POST() {
  const session = getImportSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const businessId: string = session.userSpreadsheetId;

  return makeSSEStream(async (send) => {
    send({ status: 'running', message: 'Reading branches from Cin7 cache...' });

    const conn = await getLegacyConn(businessId);
    let rows: { cin7_id: number; name: string; is_active: number }[] = [];
    try {
      const [result] = await conn.execute<any[]>(
        `SELECT cin7_id, name, is_active
         FROM branches WHERE business_id = ? ORDER BY name`,
        [businessId],
      );
      rows = result;
      send({ status: 'running', message: `Found ${rows.length} branches.` });
    } finally {
      await conn.end().catch(() => {});
    }

    if (rows.length === 0) {
      send({ status: 'done', added: 0, skipped: 0, message: 'No branches found in cache — run Cin7 sync first.' });
      return;
    }

    // Load existing locations keyed by cin7_branch_id
    const existing = await imsQuery<{ id: number; cin7_branch_id: number }>(
      'SELECT id, cin7_branch_id FROM ims_locations WHERE cin7_branch_id IS NOT NULL',
    );
    const existingMap = new Map(existing.map(l => [l.cin7_branch_id, l.id]));

    let added = 0; let skipped = 0;
    for (const row of rows) {
      if (existingMap.has(row.cin7_id)) {
        // Update name / active status in case it changed
        await imsExecute(
          'UPDATE ims_locations SET name = ?, is_active = ? WHERE cin7_branch_id = ?',
          [row.name, row.is_active, row.cin7_id],
        );
        skipped++;
      } else {
        await imsExecute(
          'INSERT INTO ims_locations (name, is_active, cin7_branch_id) VALUES (?, ?, ?)',
          [row.name, row.is_active, row.cin7_id],
        );
        added++;
      }
    }

    send({ status: 'done', added, skipped, message: `Done — ${added} added, ${skipped} already existed (updated).` });
  });
}
