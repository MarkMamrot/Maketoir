import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { getCin7Credentials, cin7FetchAllPages } from '@/lib/cin7Helpers';
import { getImportSession, makeSSEStream } from '../_helpers';

export async function POST() {
  const session = getImportSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const businessId: string = session.userSpreadsheetId;

  return makeSSEStream(async (send) => {
    send({ status: 'running', message: 'Connecting to Cin7 API...' });

    // Load credentials from connections table
    let creds: Awaited<ReturnType<typeof getCin7Credentials>>;
    try {
      creds = await getCin7Credentials(businessId);
    } catch (e: any) {
      send({ status: 'error', message: `Credentials error: ${e.message}` });
      return;
    }

    // Fetch all contacts from Cin7, filter to customers
    send({ status: 'running', message: 'Fetching contacts from Cin7 (this may take a while)...' });
    let contacts: any[];
    try {
      const all = await cin7FetchAllPages(creds.authHeader, '/Contacts', {}, 'ims/customers');
      contacts = all.filter(c => {
        const t = (c.type ?? '').toLowerCase();
        return t === 'customer' || t === 'supplier/customer';
      });
      send({ status: 'running', message: `Fetched ${all.length} total contacts. Found ${contacts.length} customers.` });
    } catch (e: any) {
      send({ status: 'error', message: `Cin7 API error: ${e.message}` });
      return;
    }

    if (contacts.length === 0) {
      send({ status: 'done', added: 0, updated: 0, message: 'No customers found in Cin7.' });
      return;
    }

    // Build map of existing cin7_contact_id → ims contact id
    const existing = await imsQuery<{ id: number; cin7_contact_id: number | null }>(
      `SELECT id, cin7_contact_id FROM ims_contacts
       WHERE cin7_contact_id IS NOT NULL AND (type = 'customer' OR type = 'both')`,
    );
    const existingMap = new Map(existing.map(r => [r.cin7_contact_id!, r.id]));

    send({ status: 'running', message: `Upserting ${contacts.length} customers into IMS...` });

    let added = 0; let updated = 0;
    for (const c of contacts) {
      const cin7Id = Number(c.id);
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.company || String(c.id);
      const company = c.company || null;
      const email = c.email || null;
      const phone = c.phone || c.mobile || null;
      const address = c.address1 || c.address || null;
      const city = c.city || null;
      const state = c.state || null;
      const postcode = c.postCode || c.postcode || null;
      const country = c.country || null;
      const isActive = c.isActive !== false ? 1 : 0;

      // Determine type — if they're also a supplier in our DB, mark 'both'
      const supplierRow = await imsQuery<{ id: number }>(
        'SELECT id FROM ims_contacts WHERE cin7_supplier_id = ? LIMIT 1',
        [cin7Id],
      );
      const contactType = supplierRow.length > 0 ? 'both' : 'customer';

      if (existingMap.has(cin7Id)) {
        await imsExecute(
          `UPDATE ims_contacts SET name=?, company=?, email=?, phone=?, address=?, city=?, state=?,
           postcode=?, country=?, is_active=?, type=?
           WHERE cin7_contact_id=?`,
          [name, company, email, phone, address, city, state, postcode, country, isActive, contactType, cin7Id],
        );
        updated++;
      } else if (supplierRow.length > 0) {
        // Already exists as supplier — just add cin7_contact_id and upgrade type to 'both'
        await imsExecute(
          `UPDATE ims_contacts SET cin7_contact_id=?, type='both', email=COALESCE(email,?), phone=COALESCE(phone,?)
           WHERE cin7_supplier_id=?`,
          [cin7Id, email, phone, cin7Id],
        );
        updated++;
      } else {
        await imsExecute(
          `INSERT INTO ims_contacts
             (type, name, company, email, phone, address, city, state, postcode, country, is_active, cin7_contact_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [contactType, name, company, email, phone, address, city, state, postcode, country, isActive, cin7Id],
        );
        added++;
      }
    }

    send({ status: 'done', added, updated, message: `Done — ${added} added, ${updated} updated.` });
  });
}
