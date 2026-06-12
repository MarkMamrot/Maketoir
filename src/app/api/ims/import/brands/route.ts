import { imsExecute } from '@/services/IMSMySQLService';
import { getImportSession, getLegacyConn, makeSSEStream } from '../_helpers';

export async function POST() {
  const session = getImportSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const businessId: string = session.userSpreadsheetId;

  return makeSSEStream(async (send) => {
    send({ status: 'running', message: 'Reading brands from Cin7 products cache...' });

    // Pull distinct non-null brands from the Cin7 products cache
    const conn = await getLegacyConn(businessId);
    let rows: { brand: string }[] = [];
    try {
      const [result] = await conn.execute<any[]>(
        `SELECT DISTINCT brand FROM products
         WHERE business_id = ? AND brand IS NOT NULL AND brand != ''
         ORDER BY brand`,
        [businessId],
      );
      rows = result;
      send({ status: 'running', message: `Found ${rows.length} brands in products table.` });
    } finally {
      await conn.end().catch(() => {});
    }

    if (rows.length === 0) {
      send({ status: 'done', added: 0, skipped: 0, message: 'No brands found — check business_id matches.' });
      return;
    }

    send({ status: 'running', message: `Upserting ${rows.length} brands into IMS...` });
    let added = 0; let skipped = 0;
    for (const { brand } of rows) {
      const res = await imsExecute(
        'INSERT IGNORE INTO ims_brands (name) VALUES (?)',
        [brand.trim()],
      ) as any;
      res.affectedRows > 0 ? added++ : skipped++;
    }

    send({ status: 'done', added, skipped, message: `Done — ${added} added, ${skipped} already existed.` });
  });
}
