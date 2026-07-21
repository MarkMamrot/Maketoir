/**
 * Automated IMS provisioning for a new business.
 *
 * Creates a new schema on the SAME MySQL server (Railway "MySQL-HVk4"), runs the
 * IMS schema DDL into it, installs the business_id integrity triggers, and
 * records the schema name on businesses.ims_db_name. No new Railway service and
 * no manual steps — one function call onboards a business's IMS.
 */
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { execute } from '@/services/MySQLService';
import { invalidateImsDbCache } from '@/lib/db/BusinessRegistry';

/** MySQL identifiers can't be parameterised — allow only safe characters. */
function safeDbName(name: string): string {
  const clean = String(name).replace(/[^a-zA-Z0-9_]/g, '');
  if (!clean || clean.length > 60) throw new Error(`Invalid IMS database name: ${name}`);
  return clean;
}

/** Derive a schema name from a business display name, e.g. "Acme Co" → readyedu_AcmeCoIMS. */
export function deriveImsDbName(businessName: string): string {
  const prefix = process.env.IMS_DB_PREFIX ?? 'readyedu_';
  const slug = String(businessName).replace(/[^a-zA-Z0-9]/g, '');
  if (!slug) throw new Error('Business name has no usable characters for a schema name');
  return safeDbName(`${prefix}${slug}IMS`);
}

function deriveProvisionedImsDbName(businessName: string, businessId: string): string {
  const prefix = process.env.IMS_DB_PREFIX ?? 'readyedu_';
  const slug = String(businessName).replace(/[^a-zA-Z0-9]/g, '') || 'Business';
  const suffix = String(businessId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  if (!suffix) throw new Error('Business id has no usable characters for a schema name');
  const maxSlugLength = 60 - prefix.length - suffix.length - '_IMS'.length;
  const truncatedSlug = slug.slice(0, Math.max(1, maxSlugLength));
  return safeDbName(`${prefix}${truncatedSlug}_${suffix}IMS`);
}

/** A raw connection to the MySQL server (no specific schema bound). */
async function serverConnection(database?: string): Promise<mysql.Connection> {
  return mysql.createConnection({
    host:     process.env.IMS_MYSQL_HOST ?? process.env.MYSQL_HOST ?? '127.0.0.1',
    port:     parseInt(process.env.MYSQL_PORT ?? '3306', 10),
    user:     process.env.MYSQL_USER ?? '',
    password: process.env.MYSQL_PASSWORD ?? '',
    database,
    multipleStatements: false,
  });
}

/** Split the IMS schema DDL into individual, comment-stripped statements. */
function loadSchemaStatements(): string[] {
  const schemaPath = path.join(process.cwd(), 'scripts', 'ims-schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  return sql
    .split(';')
    .map(s => s.trim())
    .map(s => s.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n').trim())
    .filter(s => s.length > 0 && !s.toUpperCase().startsWith('SET NAMES'));
}

/** Install the BEFORE INSERT business_id triggers on a freshly-created schema. */
async function installBusinessIdTriggers(conn: mysql.Connection): Promise<void> {
  const derive = (col: string) =>
    `SET NEW.business_id = IF(NEW.business_id IS NULL OR NEW.business_id = '',` +
    ` COALESCE((SELECT p.business_id FROM ims_product_variants v` +
    ` JOIN ims_products p ON p.product_id = v.product_id` +
    ` WHERE v.variant_id = NEW.${col} LIMIT 1), ''), NEW.business_id)`;
  const triggers = [
    { name: 'trg_ims_stock_bizid',       table: 'ims_stock',       body: derive('variant_id') },
    { name: 'trg_ims_sales_cache_bizid', table: 'ims_sales_cache', body: derive('variant_id') },
  ];
  for (const t of triggers) {
    await conn.query(`DROP TRIGGER IF EXISTS \`${t.name}\``);
    await conn.query(`CREATE TRIGGER \`${t.name}\` BEFORE INSERT ON \`${t.table}\` FOR EACH ROW ${t.body}`);
  }
}

/**
 * Create (idempotently) the IMS schema for a business and load the full schema.
 * Safe to re-run: CREATE DATABASE / tables use IF NOT EXISTS; triggers are replaced.
 */
export async function createImsDatabase(dbName: string): Promise<void> {
  const db = safeDbName(dbName);

  // 1. Create the schema on the server.
  const server = await serverConnection();
  try {
    await server.query(
      `CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await server.end();
  }

  // 2. Load the DDL + triggers into the new schema.
  const conn = await serverConnection(db);
  try {
    for (const stmt of loadSchemaStatements()) {
      await conn.query(stmt);
    }
    await installBusinessIdTriggers(conn);
  } finally {
    await conn.end();
  }
}

export interface ProvisionResult {
  businessId: string;
  imsDbName: string;
  created: boolean;
}

/**
 * Provision IMS for an EXISTING business row: create its schema, load the DDL,
 * and record businesses.ims_db_name. Pass an explicit imsDbName to override the
 * derived one. Idempotent.
 */
export async function provisionBusinessIms(opts: {
  businessId: string;
  businessName: string;
  imsDbName?: string;
}): Promise<ProvisionResult> {
  const dbName = safeDbName(opts.imsDbName ?? deriveProvisionedImsDbName(opts.businessName, opts.businessId));

  await createImsDatabase(dbName);

  await execute(
    `UPDATE businesses SET ims_db_name = ?, has_ims = 1 WHERE business_id = ?`,
    [dbName, opts.businessId],
  );
  invalidateImsDbCache(opts.businessId);

  return { businessId: opts.businessId, imsDbName: dbName, created: true };
}
