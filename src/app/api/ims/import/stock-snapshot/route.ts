import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { getImportSession, getLegacyConn, makeSSEStream } from '../_helpers';

export async function POST() {
  const session = getImportSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const businessId: string = session.userSpreadsheetId;

  return makeSSEStream(async (send) => {
    send({ status: 'running', message: 'Reading Cin7 stock cache...' });

    const conn = await getLegacyConn(businessId);
    try {
      // Read current SOH + incoming from Cin7 cache
      const [stockRows] = await conn.execute<any[]>(
        `SELECT product_option_id, branch_id, available, incoming
         FROM stock
         WHERE business_id = ?`,
        [businessId],
      );
      send({ status: 'running', message: `Found ${stockRows.length} stock rows. Mapping...` });

      // Pre-load lookup maps
      const variants = await imsQuery<{ variant_id: string; cin7_option_id: number }>(
        'SELECT variant_id, cin7_option_id FROM ims_product_variants WHERE cin7_option_id IS NOT NULL',
      );
      const variantMap = new Map(variants.map(v => [v.cin7_option_id, v.variant_id]));

      const locations = await imsQuery<{ id: number; cin7_branch_id: number }>(
        'SELECT id, cin7_branch_id FROM ims_locations WHERE cin7_branch_id IS NOT NULL',
      );
      const locMap = new Map(locations.map(l => [l.cin7_branch_id, l.id]));

      let upserted = 0; let skipped = 0;

      for (const row of stockRows) {
        const variantId = variantMap.get(Number(row.product_option_id));
        const locationId = locMap.get(Number(row.branch_id));

        if (!variantId || !locationId) { skipped++; continue; }

        const qtyOnHand  = Number(row.available ?? 0);
        const qtyIncoming = Number(row.incoming ?? 0);

        await imsExecute(
          `INSERT INTO ims_stock (variant_id, location_id, qty_on_hand, qty_incoming)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             qty_on_hand  = VALUES(qty_on_hand),
             qty_incoming = VALUES(qty_incoming)`,
          [variantId, locationId, qtyOnHand, qtyIncoming],
        );
        upserted++;
      }

      send({
        status: 'done', upserted, skipped,
        message: `Done — ${upserted} stock rows set, ${skipped} skipped (unmapped variant or location).`,
      });
    } finally {
      await conn.end().catch(() => {});
    }
  });
}
