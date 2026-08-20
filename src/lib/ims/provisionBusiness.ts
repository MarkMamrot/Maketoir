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
import { execute, getPool, query } from '@/services/MySQLService';
import { invalidateImsDbCache } from '@/lib/db/BusinessRegistry';
import {
  IMS_SCHEMA_REQUIRED_COLUMNS,
  IMS_SCHEMA_REQUIRED_INDEXES,
  IMS_SCHEMA_REQUIRED_TABLES,
} from '@/lib/ims/schemaContract';

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

export function deriveProvisionedImsDbName(businessName: string, businessId: string): string {
  const prefix = process.env.IMS_DB_PREFIX ?? 'readyedu_';
  const slug = String(businessName).replace(/[^a-zA-Z0-9]/g, '') || 'Business';
  const suffix = String(businessId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  if (!suffix) throw new Error('Business id has no usable characters for a schema name');
  const maxSlugLength = 60 - prefix.length - suffix.length - '_IMS'.length;
  const truncatedSlug = slug.slice(0, Math.max(1, maxSlugLength));
  return safeDbName(`${prefix}${truncatedSlug}_${suffix}IMS`);
}

export class ImsProvisioningError extends Error {
  constructor(
    message: string,
    public readonly imsDbName: string,
    public readonly schemaCreated: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ImsProvisioningError';
  }
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

/** Split IMS schema DDL into individual statements after removing full-line comments. */
export function parseSchemaStatements(sql: string): string[] {
  const commentStrippedSql = sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');
  const statements: string[] = [];
  let current = '';
  let quote: "'" | '"' | '`' | null = null;

  for (let index = 0; index < commentStrippedSql.length; index += 1) {
    const char = commentStrippedSql[index];
    const next = commentStrippedSql[index + 1];
    current += char;

    if (quote) {
      if (char === '\\') {
        if (next !== undefined) current += commentStrippedSql[index += 1];
      } else if (char === quote && next === quote) {
        current += commentStrippedSql[index += 1];
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === ';') {
      statements.push(current.slice(0, -1));
      current = '';
    }
  }
  if (current.trim()) statements.push(current);

  return statements
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.toUpperCase().startsWith('SET NAMES'));
}

function loadSchemaStatements(): string[] {
  const schemaPath = path.join(process.cwd(), 'scripts', 'ims-schema.sql');
  return parseSchemaStatements(fs.readFileSync(schemaPath, 'utf8'));
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

async function schemaExists(dbName: string): Promise<boolean> {
  const connection = await serverConnection();
  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1',
      [dbName],
    );
    return rows.length > 0;
  } finally {
    await connection.end();
  }
}

async function createNewImsDatabase(dbName: string): Promise<void> {
  const db = safeDbName(dbName);
  const connection = await serverConnection();
  try {
    await connection.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await connection.end();
  }
}

export async function validateImsSchema(dbName: string): Promise<void> {
  const db = safeDbName(dbName);
  const connection = await serverConnection();
  try {
    const [columnRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME, COLUMN_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?`,
      [db],
    );
    const columns = new Set(columnRows.map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
    const tables = new Set(columnRows.map(row => String(row.TABLE_NAME)));
    const missingTables = IMS_SCHEMA_REQUIRED_TABLES.filter(table => !tables.has(table));
    const missingColumns = Object.entries(IMS_SCHEMA_REQUIRED_COLUMNS).flatMap(([table, required]) =>
      required.filter(column => !columns.has(`${table}.${column}`)).map(column => `${table}.${column}`),
    );

    const [indexRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME, INDEX_NAME
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?`,
      [db],
    );
    const indexes = new Set(indexRows.map(row => `${row.TABLE_NAME}.${row.INDEX_NAME}`));
    const missingIndexes = Object.entries(IMS_SCHEMA_REQUIRED_INDEXES).flatMap(([table, required]) =>
      required.filter(index => !indexes.has(`${table}.${index}`)).map(index => `${table}.${index}`),
    );

    const [triggerRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TRIGGER_NAME
         FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = ?`,
      [db],
    );
    const triggers = new Set(triggerRows.map(row => String(row.TRIGGER_NAME)));
    const missingTriggers = ['trg_ims_stock_bizid', 'trg_ims_sales_cache_bizid']
      .filter(trigger => !triggers.has(trigger));

    const gaps = [...missingTables, ...missingColumns, ...missingIndexes, ...missingTriggers];
    if (gaps.length > 0) throw new Error(`IMS schema validation failed: ${gaps.join(', ')}`);
  } finally {
    await connection.end();
  }
}

export interface ProvisionResult {
  businessId: string;
  imsDbName: string;
  created: boolean;
  schemaCreated: boolean;
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
  let schemaCreated = false;
  try {
    if (await schemaExists(dbName)) {
      throw new Error(`IMS schema already exists: ${dbName}`);
    }
    await createNewImsDatabase(dbName);
    schemaCreated = true;

    const connection = await serverConnection(dbName);
    try {
      for (const statement of loadSchemaStatements()) await connection.query(statement);
      await installBusinessIdTriggers(connection);
    } finally {
      await connection.end();
    }
    await validateImsSchema(dbName);

    await execute(
      `UPDATE businesses SET ims_db_name = ?, has_ims = 1 WHERE business_id = ?`,
      [dbName, opts.businessId],
    );
    invalidateImsDbCache(opts.businessId);
    return { businessId: opts.businessId, imsDbName: dbName, created: true, schemaCreated };
  } catch (error) {
    throw new ImsProvisioningError(
      error instanceof Error ? error.message : 'IMS provisioning failed',
      dbName,
      schemaCreated,
      { cause: error },
    );
  }
}

export interface ProvisionCleanupResult {
  schemaDropped: boolean;
  businessDeleted: boolean;
  errors: string[];
}

export async function cleanupFailedBusinessProvision(input: {
  businessId: string;
  imsDbName?: string | null;
  schemaCreated: boolean;
  businessCreated: boolean;
}): Promise<ProvisionCleanupResult> {
  const result: ProvisionCleanupResult = { schemaDropped: false, businessDeleted: false, errors: [] };

  if (input.schemaCreated && input.imsDbName) {
    try {
      const dbName = safeDbName(input.imsDbName);
      const references = await query<{ business_id: string }>(
        `SELECT business_id FROM businesses
          WHERE ims_db_name = ? AND business_id <> ? AND deleted_at IS NULL
          LIMIT 1`,
        [dbName, input.businessId],
      );
      if (references.length > 0) throw new Error('IMS schema is referenced by another active business');
      const connection = await serverConnection();
      try {
        await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
        result.schemaDropped = true;
      } finally {
        await connection.end();
      }
    } catch (error) {
      result.errors.push(`schema: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (input.businessCreated) {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      for (const table of ['config', 'business_info', 'users']) {
        await connection.execute(`DELETE FROM ${table} WHERE business_id = ?`, [input.businessId]);
      }
      const [deletion] = await connection.execute<mysql.ResultSetHeader>(
        'DELETE FROM businesses WHERE business_id = ?',
        [input.businessId],
      );
      await connection.commit();
      result.businessDeleted = deletion.affectedRows > 0;
      invalidateImsDbCache(input.businessId);
    } catch (error) {
      await connection.rollback().catch(() => {});
      result.errors.push(`business: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      connection.release();
    }
  }

  return result;
}
