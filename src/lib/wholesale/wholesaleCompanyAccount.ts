import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getIMSPool } from '@/services/IMSMySQLService';

interface ContactRow extends RowDataPacket {
  id: number;
  type: string;
  address: string | null;
  address2: string | null;
  suburb: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
}

interface IdRow extends RowDataPacket {
  id: number;
}

export interface ApprovedWholesaleAccountIds {
  contactId: number;
  companyId: number;
  locationId: number;
  memberId: number;
}

export async function ensureApprovedWholesaleAccount(input: {
  businessId: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string | null;
  abn: string | null;
  allowedBrands: string[] | null;
  onAccountLimit: number | null;
}): Promise<ApprovedWholesaleAccountIds> {
  return runImsForBusiness(input.businessId, async () => {
    const connection = await getIMSPool().getConnection();
    try {
      await connection.beginTransaction();
      const [contactRows] = await connection.execute<ContactRow[]>(
        `SELECT id, type, address, address2, suburb, city, state, postcode, country
           FROM ims_contacts
          WHERE business_id = ? AND LOWER(email) = ?
          ORDER BY id LIMIT 1 FOR UPDATE`,
        [input.businessId, input.email],
      );
      const existingContact = contactRows[0];
      const brandsJson = input.allowedBrands === null ? null : JSON.stringify(input.allowedBrands);
      let contactId: number;
      if (existingContact) {
        const type = existingContact.type === 'supplier' || existingContact.type === 'both' ? 'both' : 'b2b_customer';
        await connection.execute(
          `UPDATE ims_contacts
              SET type = ?, price_tier = 'wholesale', is_active = 1,
                  wholesale_allowed_brands_json = ?, on_account_limit = COALESCE(?, on_account_limit),
                  company = COALESCE(NULLIF(company, ''), ?), name = COALESCE(NULLIF(name, ''), ?),
                  phone = COALESCE(NULLIF(phone, ''), ?)
            WHERE id = ? AND business_id = ?`,
          [type, brandsJson, input.onAccountLimit, input.companyName, input.contactName,
            input.phone, existingContact.id, input.businessId],
        );
        contactId = Number(existingContact.id);
      } else {
        const [contactResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO ims_contacts
             (business_id, type, name, company, email, phone, notes, is_active, price_tier,
              wholesale_allowed_brands_json, on_account_limit, charges_tax, prices_include_tax)
           VALUES (?, 'b2b_customer', ?, ?, ?, ?, ?, 1, 'wholesale', ?, ?, 1, 1)`,
          [input.businessId, input.contactName, input.companyName, input.email, input.phone,
            input.abn ? `Wholesale application ABN: ${input.abn}` : null, brandsJson, input.onAccountLimit],
        );
        contactId = Number(contactResult.insertId);
        await connection.execute(
          `UPDATE ims_contacts SET customer_code = CONCAT('C-', LPAD(?, 6, '0'))
            WHERE id = ? AND (customer_code IS NULL OR customer_code = '')`,
          [contactId, contactId],
        );
      }

      const [companyRows] = await connection.execute<IdRow[]>(
        `SELECT id FROM ims_wholesale_companies
          WHERE business_id = ? AND primary_contact_id = ? LIMIT 1 FOR UPDATE`,
        [input.businessId, contactId],
      );
      let companyId = Number(companyRows[0]?.id ?? 0);
      if (companyId) {
        await connection.execute(
          `UPDATE ims_wholesale_companies
              SET company_name = ?, tax_id = COALESCE(?, tax_id),
                  on_account_limit = COALESCE(?, on_account_limit), status = 'active'
            WHERE id = ? AND business_id = ?`,
          [input.companyName, input.abn, input.onAccountLimit, companyId, input.businessId],
        );
      } else {
        const [companyResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO ims_wholesale_companies
             (business_id, primary_contact_id, company_name, tax_id, on_account_limit)
           VALUES (?, ?, ?, ?, ?)`,
          [input.businessId, contactId, input.companyName, input.abn, input.onAccountLimit],
        );
        companyId = Number(companyResult.insertId);
      }

      const [locationRows] = await connection.execute<IdRow[]>(
        `SELECT id FROM ims_wholesale_company_locations
          WHERE business_id = ? AND company_id = ? AND is_primary = 1
          ORDER BY id LIMIT 1 FOR UPDATE`,
        [input.businessId, companyId],
      );
      let locationId = Number(locationRows[0]?.id ?? 0);
      if (locationId) {
        await connection.execute(
          `UPDATE ims_wholesale_company_locations SET status = 'active'
            WHERE id = ? AND business_id = ?`,
          [locationId, input.businessId],
        );
      } else {
        const address = existingContact ?? {} as Partial<ContactRow>;
        const [locationResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO ims_wholesale_company_locations
             (business_id, company_id, location_name,
              billing_address, billing_address2, billing_suburb, billing_city, billing_state, billing_postcode, billing_country,
              shipping_address, shipping_address2, shipping_suburb, shipping_city, shipping_state, shipping_postcode, shipping_country)
           VALUES (?, ?, 'Primary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [input.businessId, companyId, address.address ?? null, address.address2 ?? null,
            address.suburb ?? null, address.city ?? null, address.state ?? null, address.postcode ?? null,
            address.country || 'Australia', address.address ?? null, address.address2 ?? null,
            address.suburb ?? null, address.city ?? null, address.state ?? null, address.postcode ?? null,
            address.country || 'Australia'],
        );
        locationId = Number(locationResult.insertId);
      }

      const [memberRows] = await connection.execute<IdRow[]>(
        `SELECT id FROM ims_wholesale_company_members
          WHERE business_id = ? AND company_id = ? AND contact_id = ? LIMIT 1 FOR UPDATE`,
        [input.businessId, companyId, contactId],
      );
      let memberId = Number(memberRows[0]?.id ?? 0);
      if (memberId) {
        await connection.execute(
          `UPDATE ims_wholesale_company_members
              SET location_id = ?, role = 'owner', is_active = 1
            WHERE id = ? AND business_id = ?`,
          [locationId, memberId, input.businessId],
        );
      } else {
        const [memberResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO ims_wholesale_company_members
             (business_id, company_id, location_id, contact_id, role)
           VALUES (?, ?, ?, ?, 'owner')`,
          [input.businessId, companyId, locationId, contactId],
        );
        memberId = Number(memberResult.insertId);
      }

      await connection.commit();
      return { contactId, companyId, locationId, memberId };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
}