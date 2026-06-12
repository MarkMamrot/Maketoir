import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { getImportSession, getLegacyConn, makeSSEStream } from '../_helpers';

export async function POST() {
  const session = getImportSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const businessId: string = session.userSpreadsheetId;

  return makeSSEStream(async (send) => {
    send({ status: 'running', message: 'Reading suppliers from database...' });

    const conn = await getLegacyConn(businessId);
    try {
      const [suppliers] = await conn.execute<any[]>(
        `SELECT cin7_id, name, contact_name, email, phone, country, lead_time_days
         FROM suppliers WHERE business_id = ? ORDER BY name`,
        [businessId],
      );
      send({ status: 'running', message: `Found ${suppliers.length} suppliers. Upserting...` });

      // Build map of existing cin7_supplier_id → ims contact id
      const existing = await imsQuery<{ id: number; cin7_supplier_id: number | null }>(
        'SELECT id, cin7_supplier_id FROM ims_contacts WHERE cin7_supplier_id IS NOT NULL',
      );
      const existingMap = new Map(existing.map(r => [r.cin7_supplier_id!, r.id]));

      let added = 0; let updated = 0;
      for (const s of suppliers) {
        const name = (s.name || s.contact_name || '').trim();
        if (!name) continue;

        if (existingMap.has(s.cin7_id)) {
          // Update existing contact
          await imsExecute(
            `UPDATE ims_contacts SET name=?, company=?, email=?, phone=?, country=?, lead_time_days=?
             WHERE cin7_supplier_id=?`,
            [name, s.name || null, s.email || null, s.phone || null,
             s.country || 'Australia', s.lead_time_days ?? null, s.cin7_id],
          );
          updated++;
        } else {
          // Insert new contact
          await imsExecute(
            `INSERT INTO ims_contacts (type,name,company,email,phone,country,is_active,cin7_supplier_id,lead_time_days)
             VALUES ('supplier',?,?,?,?,?,1,?,?)`,
            [name, s.name || null, s.email || null, s.phone || null,
             s.country || 'Australia', s.cin7_id, s.lead_time_days ?? null],
          );
          added++;
        }
      }

      send({ status: 'done', added, updated, message: `Done — ${added} added, ${updated} updated.` });
    } finally {
      await conn.end().catch(() => {});
    }
  });
}
