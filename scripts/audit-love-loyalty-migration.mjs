/**
 * Audit a Love Loyalty customer export before importing opening balances.
 *
 * Usage:
 *   node scripts/audit-love-loyalty-migration.mjs
 *   node scripts/audit-love-loyalty-migration.mjs path/to/customers-export.csv
 *
 * This script is intentionally read-only. Love Loyalty exports customerId in
 * lossy scientific notation, so the exact Shopify ID is recovered from the
 * base64url referral_code instead.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

dotenv.config();

const CSV_PATH = path.resolve(process.argv[2] || 'customers/customers-export.csv');
const EXPECTED_SCHEMA = 'readyedu_MonsterthreadsIMS';
const REPORT_PATH = path.resolve('tmp/love-loyalty-migration-audit.json');
const BATCH_SIZE = 500;
const REQUIRED_HEADERS = ['customerId', 'email', 'name', 'points', 'referralUrl'];

function connectionConfig(database) {
  return {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database,
    connectTimeout: 20_000,
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(field);
      field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some(value => value !== '')) rows.push(row);
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  return rows;
}

function exactShopifyId(referralUrl) {
  let code;
  try { code = new URL(referralUrl).searchParams.get('referral_code'); }
  catch { return null; }
  if (!code) return null;
  try {
    const decoded = Buffer.from(code, 'base64url').toString('utf8');
    return /^\d+$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function batches(values) {
  const result = [];
  for (let index = 0; index < values.length; index += BATCH_SIZE) result.push(values.slice(index, index + BATCH_SIZE));
  return result;
}

async function loadContacts(connection, businessId, values, column) {
  const contacts = [];
  for (const batch of batches(values)) {
    const placeholders = batch.map(() => '?').join(',');
    const [rows] = await connection.execute(
      `SELECT id, shopify_customer_id, LOWER(TRIM(email)) AS normalized_email, is_active
         FROM ims_contacts
        WHERE business_id = ? AND ${column} IN (${placeholders})`,
      [businessId, ...batch],
    );
    contacts.push(...rows);
  }
  return contacts;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`Export not found: ${CSV_PATH}`);
  const parsed = parseCsv(fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, ''));
  if (parsed.length < 2) throw new Error('Love Loyalty export contains no customer rows.');
  const headers = parsed[0];
  for (const header of REQUIRED_HEADERS) if (!headers.includes(header)) throw new Error(`Missing required column: ${header}`);
  const rows = parsed.slice(1).map((values, index) => Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ''])));

  const malformed = [];
  const records = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const shopifyCustomerId = exactShopifyId(row.referralUrl);
    const points = Number(row.points);
    const email = row.email.trim().toLowerCase();
    if (!shopifyCustomerId || !Number.isSafeInteger(points) || points < 0 || !email) {
      malformed.push({ row: index + 2, customerId: row.customerId, email, points: row.points, reason: !shopifyCustomerId ? 'invalid_referral_customer_id' : !email ? 'blank_email' : 'invalid_points' });
      continue;
    }
    records.push({ row: index + 2, shopifyCustomerId, email, name: row.name.trim(), points, vipTierName: row.vipTierName.trim(), lifetimePointsEarned: Number(row.lifetimePointsEarned || 0), lifetimePointsRedeemed: Number(row.lifetimePointsRedeemed || 0) });
  }

  const idGroups = new Map();
  const emailGroups = new Map();
  for (const record of records) {
    idGroups.set(record.shopifyCustomerId, [...(idGroups.get(record.shopifyCustomerId) || []), record]);
    emailGroups.set(record.email, [...(emailGroups.get(record.email) || []), record]);
  }
  const duplicateIds = [...idGroups.entries()].filter(([, group]) => group.length > 1).map(([shopifyCustomerId, group]) => ({ shopifyCustomerId, rows: group.map(record => record.row) }));
  const duplicateEmails = [...emailGroups.entries()].filter(([, group]) => group.length > 1).map(([email, group]) => ({ email, shopifyCustomerIds: group.map(record => record.shopifyCustomerId) }));

  const mainDb = await mysql.createConnection(connectionConfig(process.env.MYSQL_DATABASE));
  let imsDb;
  try {
    const [businessRows] = await mainDb.execute(
      `SELECT b.business_id, b.name, b.ims_db_name
         FROM businesses b
         JOIN connections c ON c.business_id = b.business_id
        WHERE b.deleted_at IS NULL AND b.ims_db_name = ?
          AND LOWER(TRIM(TRAILING '/' FROM REPLACE(REPLACE(c.shopify_shop_id, 'https://', ''), 'http://', ''))) = 'monsterthreads.myshopify.com'`,
      [EXPECTED_SCHEMA],
    );
    if (businessRows.length !== 1) throw new Error(`Expected one live Monsterthreads business, found ${businessRows.length}.`);
    const business = businessRows[0];
    imsDb = await mysql.createConnection(connectionConfig(business.ims_db_name));

    const ids = [...idGroups.keys()];
    const emails = [...emailGroups.keys()];
    const [idContacts, emailContacts] = await Promise.all([
      loadContacts(imsDb, business.business_id, ids, 'shopify_customer_id'),
      loadContacts(imsDb, business.business_id, emails, 'LOWER(TRIM(email))'),
    ]);
    const contactsByShopifyId = new Map();
    const contactsByEmail = new Map();
    for (const contact of idContacts) contactsByShopifyId.set(String(contact.shopify_customer_id), [...(contactsByShopifyId.get(String(contact.shopify_customer_id)) || []), contact]);
    for (const contact of emailContacts) contactsByEmail.set(contact.normalized_email, [...(contactsByEmail.get(contact.normalized_email) || []), contact]);

    const exactMatches = [];
    const duplicateExactMatches = [];
    const uniqueEmailCandidates = [];
    const ambiguousEmailCandidates = [];
    const missingContacts = [];
    for (const record of records) {
      const exact = contactsByShopifyId.get(record.shopifyCustomerId) || [];
      if (exact.length === 1) { exactMatches.push({ ...record, contactId: Number(exact[0].id), contactActive: Boolean(exact[0].is_active), imsEmail: exact[0].normalized_email }); continue; }
      if (exact.length > 1) { duplicateExactMatches.push({ ...record, contactIds: exact.map(contact => Number(contact.id)) }); continue; }
      const emailCandidates = contactsByEmail.get(record.email) || [];
      if (emailCandidates.length === 1) uniqueEmailCandidates.push({ ...record, candidateContactId: Number(emailCandidates[0].id), candidateShopifyCustomerId: emailCandidates[0].shopify_customer_id });
      else if (emailCandidates.length > 1) ambiguousEmailCandidates.push({ ...record, candidateContactIds: emailCandidates.map(contact => Number(contact.id)) });
      else missingContacts.push(record);
    }

    let existingAccounts = [];
    const exactContactIds = [...new Set(exactMatches.map(record => record.contactId))];
    for (const batch of batches(exactContactIds)) {
      const placeholders = batch.map(() => '?').join(',');
      const [accountRows] = await imsDb.execute(
        `SELECT a.contact_id, a.balance_points, a.lifetime_earned, a.lifetime_redeemed,
                COUNT(t.id) AS transaction_count,
                SUM(CASE WHEN t.type <> 'migration' THEN 1 ELSE 0 END) AS non_migration_transaction_count
           FROM loyalty_accounts a
           LEFT JOIN loyalty_transactions t ON t.business_id = a.business_id AND t.account_id = a.id
          WHERE a.business_id = ? AND a.contact_id IN (${placeholders})
          GROUP BY a.id, a.contact_id, a.balance_points, a.lifetime_earned, a.lifetime_redeemed`,
        [business.business_id, ...batch],
      );
      existingAccounts.push(...accountRows.map(row => ({ ...row, contact_id: Number(row.contact_id), balance_points: Number(row.balance_points), transaction_count: Number(row.transaction_count), non_migration_transaction_count: Number(row.non_migration_transaction_count) })));
    }

    const pointTotal = records.reduce((sum, record) => sum + record.points, 0);
    const summary = {
      source: path.relative(process.cwd(), CSV_PATH).replaceAll('\\', '/'),
      businessId: business.business_id,
      tenantSchema: business.ims_db_name,
      exportRows: rows.length,
      validRows: records.length,
      totalPoints: pointTotal,
      malformedRows: malformed.length,
      duplicateShopifyIds: duplicateIds.length,
      duplicateEmails: duplicateEmails.length,
      exactShopifyIdMatches: exactMatches.length,
      inactiveExactMatches: exactMatches.filter(record => !record.contactActive).length,
      duplicateExactMatches: duplicateExactMatches.length,
      uniqueEmailCandidatesNotLinked: uniqueEmailCandidates.length,
      ambiguousEmailCandidates: ambiguousEmailCandidates.length,
      missingContacts: missingContacts.length,
      existingLoyaltyAccounts: existingAccounts.length,
      existingNonMigrationLedgers: existingAccounts.filter(account => account.non_migration_transaction_count > 0).length,
      existingBalancePoints: existingAccounts.reduce((sum, account) => sum + account.balance_points, 0),
      safeToImport: malformed.length === 0 && duplicateIds.length === 0 && duplicateExactMatches.length === 0 && uniqueEmailCandidates.length === 0 && ambiguousEmailCandidates.length === 0 && missingContacts.length === 0 && existingAccounts.every(account => account.non_migration_transaction_count === 0),
    };
    const report = { generatedAt: new Date().toISOString(), summary, exceptions: { malformed, duplicateIds, duplicateEmails, duplicateExactMatches, uniqueEmailCandidates, ambiguousEmailCandidates, missingContacts, existingAccounts } };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Detailed audit: ${path.relative(process.cwd(), REPORT_PATH)}`);
    if (!summary.safeToImport) process.exitCode = 2;
  } finally {
    await imsDb?.end();
    await mainDb.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});