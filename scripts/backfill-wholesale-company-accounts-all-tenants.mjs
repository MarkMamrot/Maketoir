/**
 * Backfill one company, primary location, and owner membership for each active
 * legacy wholesale contact. Dry run by default; pass --apply to mutate.
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const apply = process.argv.includes('--apply');
const requestedSchema = process.argv.find(argument => argument.startsWith('--schema='))?.slice('--schema='.length);
const connection = await mysql.createConnection({
  host: process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST,
  port: Number(process.env.IMS_MYSQL_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.IMS_MYSQL_USER || process.env.MYSQL_USER,
  password: process.env.IMS_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

async function loadSchemas() {
  const schemas = new Set();
  if (process.env.IMS_MYSQL_DATABASE) schemas.add(process.env.IMS_MYSQL_DATABASE);
  if (process.env.MYSQL_DATABASE) {
    const [rows] = await connection.query(
      `SELECT ims_db_name FROM \`${process.env.MYSQL_DATABASE}\`.businesses
        WHERE ims_db_name IS NOT NULL AND deleted_at IS NULL`,
    );
    for (const row of rows) if (row.ims_db_name) schemas.add(row.ims_db_name);
  }
  if (requestedSchema && !schemas.has(requestedSchema)) {
    throw new Error(`Requested schema is not registered: ${requestedSchema}`);
  }
  return requestedSchema ? [requestedSchema] : [...schemas];
}

async function loadMissingContacts(schema) {
  const [rows] = await connection.query(
    `SELECT c.id, c.business_id, c.name, c.company, c.address, c.address2,
            c.suburb, c.city, c.state, c.postcode, c.country, c.on_account_limit
       FROM \`${schema}\`.ims_contacts c
       LEFT JOIN \`${schema}\`.ims_wholesale_company_members m
         ON m.business_id = c.business_id AND m.contact_id = c.id AND m.is_active = 1
      WHERE c.is_active = 1
        AND c.type IN ('b2b_customer', 'both')
        AND LOWER(COALESCE(c.price_tier, '')) = 'wholesale'
        AND m.id IS NULL
      ORDER BY c.id`,
  );
  return rows;
}

async function backfillContact(schema, contact) {
  await connection.beginTransaction();
  try {
    await connection.query(`USE \`${schema}\``);
    const [companyRows] = await connection.query(
      `SELECT id FROM ims_wholesale_companies
        WHERE business_id = ? AND primary_contact_id = ? LIMIT 1 FOR UPDATE`,
      [contact.business_id, contact.id],
    );
    let companyId = Number(companyRows[0]?.id ?? 0);
    if (!companyId) {
      const [result] = await connection.query(
        `INSERT INTO ims_wholesale_companies
           (business_id, primary_contact_id, company_name, on_account_limit)
         VALUES (?, ?, ?, ?)`,
        [contact.business_id, contact.id, contact.company || contact.name, contact.on_account_limit],
      );
      companyId = Number(result.insertId);
    }

    const [locationRows] = await connection.query(
      `SELECT id FROM ims_wholesale_company_locations
        WHERE business_id = ? AND company_id = ? AND is_primary = 1
        ORDER BY id LIMIT 1 FOR UPDATE`,
      [contact.business_id, companyId],
    );
    let locationId = Number(locationRows[0]?.id ?? 0);
    if (!locationId) {
      const address = contact.address == null ? null : String(contact.address).slice(0, 255);
      const country = contact.country || 'Australia';
      const [result] = await connection.query(
        `INSERT INTO ims_wholesale_company_locations
           (business_id, company_id, location_name,
            billing_address, billing_address2, billing_suburb, billing_city, billing_state, billing_postcode, billing_country,
            shipping_address, shipping_address2, shipping_suburb, shipping_city, shipping_state, shipping_postcode, shipping_country)
         VALUES (?, ?, 'Primary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [contact.business_id, companyId, address, contact.address2, contact.suburb, contact.city,
          contact.state, contact.postcode, country, address, contact.address2, contact.suburb,
          contact.city, contact.state, contact.postcode, country],
      );
      locationId = Number(result.insertId);
    }

    await connection.query(
      `INSERT INTO ims_wholesale_company_members
         (business_id, company_id, location_id, contact_id, role)
       VALUES (?, ?, ?, ?, 'owner')
       ON DUPLICATE KEY UPDATE location_id = VALUES(location_id), role = 'owner', is_active = 1`,
      [contact.business_id, companyId, locationId, contact.id],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

try {
  const schemas = await loadSchemas();
  console.log(`Wholesale company account backfill (${apply ? 'apply' : 'dry run'}):`);
  for (const schema of schemas) {
    const contacts = await loadMissingContacts(schema);
    console.log(`  ${schema}: ${contacts.length} eligible contact(s) missing an account`);
    if (apply) {
      for (const contact of contacts) await backfillContact(schema, contact);
    }
  }
  if (!apply) console.log('Dry run only. Re-run with --apply to create account records.');
} finally {
  await connection.end();
}