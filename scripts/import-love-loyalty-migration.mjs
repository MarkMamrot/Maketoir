/**
 * Import Love Loyalty opening balances into the Monsterthreads loyalty ledger.
 *
 * Dry run (default): node scripts/import-love-loyalty-migration.mjs
 * Apply:             node scripts/import-love-loyalty-migration.mjs --apply
 * Custom export:     node scripts/import-love-loyalty-migration.mjs path/to/export.csv --apply
 *
 * Exact Shopify customer IDs are decoded from referral_code because the
 * export's customerId column is rounded scientific notation. Negative legacy
 * balances are clamped to zero and reported. Lifetime totals are not imported.
 */
import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const pathArgument = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const CSV_PATH = path.resolve(pathArgument || 'customers/customers-export.csv');
const EXPECTED_SCHEMA = 'readyedu_MonsterthreadsIMS';
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

function parseExport(raw) {
  const parsed = parseCsv(raw.replace(/^\uFEFF/, ''));
  if (parsed.length < 2) throw new Error('Love Loyalty export contains no customer rows.');
  const headers = parsed[0];
  for (const header of REQUIRED_HEADERS) if (!headers.includes(header)) throw new Error(`Missing required column: ${header}`);

  const records = [];
  const negativeBalances = [];
  const seenIds = new Set();
  for (let index = 1; index < parsed.length; index++) {
    const row = Object.fromEntries(headers.map((header, column) => [header, parsed[index][column] ?? '']));
    const shopifyCustomerId = exactShopifyId(row.referralUrl);
    const originalPoints = Number(row.points);
    if (!shopifyCustomerId) throw new Error(`Row ${index + 1} has no valid referral customer ID.`);
    if (!Number.isSafeInteger(originalPoints)) throw new Error(`Row ${index + 1} has invalid points: ${row.points}`);
    if (seenIds.has(shopifyCustomerId)) throw new Error(`Duplicate Shopify customer ID ${shopifyCustomerId} at row ${index + 1}.`);
    seenIds.add(shopifyCustomerId);
    const targetPoints = Math.max(0, originalPoints);
    if (originalPoints < 0) negativeBalances.push({ row: index + 1, shopifyCustomerId, originalPoints });
    records.push({ shopifyCustomerId, targetPoints, sourceRow: index + 1 });
  }
  return { records, negativeBalances };
}

async function stageRecords(connection, records) {
  await connection.execute(
    `CREATE TEMPORARY TABLE love_loyalty_import (
       shopify_customer_id VARBINARY(50) NOT NULL PRIMARY KEY,
       target_points INT UNSIGNED NOT NULL,
       source_row INT UNSIGNED NOT NULL
     ) ENGINE=InnoDB`,
  );
  for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
    const batch = records.slice(offset, offset + BATCH_SIZE);
    const placeholders = batch.map(() => '(?, ?, ?)').join(',');
    await connection.execute(
      `INSERT INTO love_loyalty_import (shopify_customer_id, target_points, source_row) VALUES ${placeholders}`,
      batch.flatMap(record => [record.shopifyCustomerId, record.targetPoints, record.sourceRow]),
    );
  }
}

async function preflight(connection, businessId, expectedRows) {
  const [[summary]] = await connection.execute(
    `SELECT COUNT(*) AS staged_rows,
            COUNT(c.id) AS joined_rows,
            COUNT(DISTINCT c.id) AS distinct_contacts,
            SUM(CASE WHEN c.id IS NULL THEN 1 ELSE 0 END) AS missing_contacts,
            SUM(CASE WHEN c.id IS NOT NULL AND c.type NOT IN ('retail_customer','b2b_customer','both') THEN 1 ELSE 0 END) AS invalid_contact_types,
            SUM(CASE WHEN c.id IS NOT NULL AND c.is_active = 0 THEN 1 ELSE 0 END) AS inactive_contacts,
            SUM(i.target_points) AS target_points
       FROM love_loyalty_import i
       LEFT JOIN ims_contacts c
         ON c.business_id = ? AND c.shopify_customer_id = i.shopify_customer_id`,
    [businessId],
  );
  const [[ledger]] = await connection.execute(
    `SELECT COUNT(DISTINCT a.id) AS existing_accounts,
            COALESCE(SUM(a.balance_points), 0) AS existing_balance_points,
            COUNT(DISTINCT CASE WHEN t.type <> 'migration' THEN a.id END) AS non_migration_accounts
       FROM love_loyalty_import i
       JOIN ims_contacts c ON c.business_id = ? AND c.shopify_customer_id = i.shopify_customer_id
       LEFT JOIN loyalty_accounts a ON a.business_id = c.business_id AND a.contact_id = c.id
       LEFT JOIN loyalty_transactions t ON t.business_id = a.business_id AND t.account_id = a.id`,
    [businessId],
  );
  const result = {
    stagedRows: Number(summary.staged_rows),
    joinedRows: Number(summary.joined_rows),
    distinctContacts: Number(summary.distinct_contacts),
    missingContacts: Number(summary.missing_contacts),
    invalidContactTypes: Number(summary.invalid_contact_types),
    inactiveContacts: Number(summary.inactive_contacts),
    targetPoints: Number(summary.target_points),
    existingAccounts: Number(ledger.existing_accounts),
    existingBalancePoints: Number(ledger.existing_balance_points),
    nonMigrationAccounts: Number(ledger.non_migration_accounts),
  };
  if (result.stagedRows !== expectedRows || result.joinedRows !== expectedRows || result.distinctContacts !== expectedRows) {
    throw new Error(`Exact Shopify-ID preflight failed: ${JSON.stringify(result)}`);
  }
  if (result.missingContacts || result.invalidContactTypes || result.nonMigrationAccounts) {
    throw new Error(`Customer or ledger preflight failed: ${JSON.stringify(result)}`);
  }
  return result;
}

async function applyImport(connection, businessId, fingerprint) {
  await connection.beginTransaction();
  try {
    const [lockedContacts] = await connection.execute(
      `SELECT c.id
         FROM love_loyalty_import i
         JOIN ims_contacts c ON c.business_id = ? AND c.shopify_customer_id = i.shopify_customer_id
        FOR UPDATE`,
      [businessId],
    );
    const checks = await preflight(connection, businessId, lockedContacts.length);

    const [membershipEvents] = await connection.execute(
      `INSERT INTO loyalty_membership_events (business_id, contact_id, action, source, terms_version)
       SELECT ?, c.id, 'enrolled', 'love_loyalty_migration', NULL
         FROM love_loyalty_import i
         JOIN ims_contacts c ON c.business_id = ? AND c.shopify_customer_id = i.shopify_customer_id
        WHERE c.loyalty_member = 0`,
      [businessId, businessId],
    );
    const [memberships] = await connection.execute(
      `UPDATE ims_contacts c
       JOIN love_loyalty_import i ON i.shopify_customer_id = c.shopify_customer_id
          SET c.loyalty_member = 1,
              c.loyalty_member_enrolled_at = COALESCE(c.loyalty_member_enrolled_at, CURRENT_TIMESTAMP),
              c.loyalty_member_opted_out_at = NULL
        WHERE c.business_id = ?`,
      [businessId],
    );
    const [accounts] = await connection.execute(
      `INSERT IGNORE INTO loyalty_accounts (business_id, contact_id)
       SELECT ?, c.id
         FROM love_loyalty_import i
         JOIN ims_contacts c ON c.business_id = ? AND c.shopify_customer_id = i.shopify_customer_id`,
      [businessId, businessId],
    );
    const idempotencyPrefix = `love-loyalty:${fingerprint}:`;
    const [transactions] = await connection.execute(
      `INSERT INTO loyalty_transactions
         (business_id, account_id, type, points_delta, balance_after, channel, source_type,
          source_id, idempotency_key, actor_id, reason)
       SELECT ?, a.id, 'migration', i.target_points - a.balance_points, i.target_points, 'migration',
              'love_loyalty_export', i.shopify_customer_id,
              CONCAT(?, i.shopify_customer_id), 'love-loyalty-migration',
              'Opening balance migrated from Love Loyalty'
         FROM love_loyalty_import i
         JOIN ims_contacts c ON c.business_id = ? AND c.shopify_customer_id = i.shopify_customer_id
         JOIN loyalty_accounts a ON a.business_id = c.business_id AND a.contact_id = c.id
         LEFT JOIN loyalty_transactions existing
           ON existing.business_id = a.business_id AND existing.idempotency_key = CONCAT(?, i.shopify_customer_id)
        WHERE i.target_points <> a.balance_points AND existing.id IS NULL`,
      [businessId, idempotencyPrefix, businessId, idempotencyPrefix],
    );
    const [balances] = await connection.execute(
      `UPDATE loyalty_accounts a
       JOIN ims_contacts c ON c.id = a.contact_id AND c.business_id = a.business_id
       JOIN love_loyalty_import i ON i.shopify_customer_id = c.shopify_customer_id
          SET a.balance_points = i.target_points
        WHERE a.business_id = ? AND a.balance_points <> i.target_points`,
      [businessId],
    );
    await connection.commit();
    return {
      ...checks,
      membershipEvents: Number(membershipEvents.affectedRows),
      membershipsChanged: Number(memberships.affectedRows),
      accountsCreated: Number(accounts.affectedRows),
      transactionsCreated: Number(transactions.affectedRows),
      balancesChanged: Number(balances.affectedRows),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function verifyImport(connection, businessId, expectedRows, expectedPoints) {
  const [[result]] = await connection.execute(
    `SELECT COUNT(DISTINCT a.id) AS accounts,
            SUM(a.balance_points) AS balance_points,
            SUM(CASE WHEN c.loyalty_member = 1 THEN 1 ELSE 0 END) AS members
       FROM love_loyalty_import i
       JOIN ims_contacts c ON c.business_id = ? AND c.shopify_customer_id = i.shopify_customer_id
       JOIN loyalty_accounts a ON a.business_id = c.business_id AND a.contact_id = c.id`,
    [businessId],
  );
  const verification = { accounts: Number(result.accounts), balancePoints: Number(result.balance_points), members: Number(result.members) };
  if (verification.accounts !== expectedRows || verification.members !== expectedRows || verification.balancePoints !== expectedPoints) {
    throw new Error(`Post-import verification failed: ${JSON.stringify(verification)}`);
  }
  return verification;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`Export not found: ${CSV_PATH}`);
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const fingerprint = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 20);
  const { records, negativeBalances } = parseExport(raw);

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
    await stageRecords(imsDb, records);
    const preflightResult = await preflight(imsDb, business.business_id, records.length);
    const summary = {
      mode: APPLY ? 'apply' : 'dry-run',
      source: path.relative(process.cwd(), CSV_PATH).replaceAll('\\', '/'),
      fingerprint,
      businessId: business.business_id,
      tenantSchema: business.ims_db_name,
      exportRows: records.length,
      negativeBalancesClampedToZero: negativeBalances.length,
      originalNegativePoints: negativeBalances.reduce((sum, record) => sum + record.originalPoints, 0),
      ...preflightResult,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!APPLY) {
      console.log('Dry run complete. No data changed. Re-run with --apply to import this exact export.');
      return;
    }
    const applied = await applyImport(imsDb, business.business_id, fingerprint);
    const verified = await verifyImport(imsDb, business.business_id, records.length, preflightResult.targetPoints);
    console.log(JSON.stringify({ applied, verified }, null, 2));
  } finally {
    await imsDb?.end();
    await mainDb.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});