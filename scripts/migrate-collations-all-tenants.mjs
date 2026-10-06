/**
 * Read-only collation audit and verification foundation.
 * Audit all tenants: node scripts/migrate-collations-all-tenants.mjs --audit
 * Audit one tenant: node scripts/migrate-collations-all-tenants.mjs --audit --schema=readyedu_ExampleIMS
 * Verify contract: node scripts/migrate-collations-all-tenants.mjs --verify [--schema=...]
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

import { buildCollationAuditReport, validateCollationContract } from './lib/collation-audit.mjs';

const supportedFlags = new Set(['--audit', '--verify']);
const positionalFlags = process.argv.slice(2).filter(argument => !argument.startsWith('--schema='));
const unsupportedFlags = positionalFlags.filter(argument => !supportedFlags.has(argument));
if (unsupportedFlags.length > 0) throw new Error(`Unsupported option(s): ${unsupportedFlags.join(', ')}`);
if (process.argv.includes('--audit') && process.argv.includes('--verify')) {
  throw new Error('Choose either --audit or --verify.');
}

const verify = process.argv.includes('--verify');
const requestedSchema = process.argv.find(argument => argument.startsWith('--schema='))?.slice('--schema='.length);
const identifierPattern = /^[A-Za-z0-9_]+$/;
if (requestedSchema && !identifierPattern.test(requestedSchema)) throw new Error('Requested schema is invalid.');

const mainDatabase = process.env.MYSQL_DATABASE;
if (!mainDatabase || !identifierPattern.test(mainDatabase)) {
  throw new Error('MYSQL_DATABASE must name the registered-business database.');
}

const contract = JSON.parse(await fs.readFile(
  path.join(process.cwd(), 'scripts', 'collation-contract.json'),
  'utf8',
));
validateCollationContract(contract);

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectTimeout: 20_000,
});

const reports = [];
try {
  const [businesses] = await connection.query(
    `SELECT business_id, ims_db_name
       FROM \`${mainDatabase}\`.businesses
      WHERE ims_db_name IS NOT NULL
        AND deleted_at IS NULL
      ORDER BY ims_db_name`,
  );
  const registeredSchemas = new Set(businesses.map(row => String(row.ims_db_name)).filter(Boolean));
  if (process.env.IMS_MYSQL_DATABASE) registeredSchemas.add(process.env.IMS_MYSQL_DATABASE);
  if (requestedSchema && !registeredSchemas.has(requestedSchema)) {
    throw new Error('Requested schema is not registered.');
  }
  const schemas = requestedSchema ? [requestedSchema] : [...registeredSchemas].sort();
  if (schemas.length === 0) throw new Error('No registered IMS tenant schemas found.');

  for (const schema of schemas) {
    if (!identifierPattern.test(schema)) throw new Error(`Registered IMS schema is invalid: ${schema}`);
    const [columnRows] = await connection.query(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLLATION_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
          AND COLUMN_NAME IN (?)
          AND COLLATION_NAME IS NOT NULL
        ORDER BY TABLE_NAME, COLUMN_NAME`,
      [schema, contract.tenantIdentityColumns],
    );
    const [tableRows] = await connection.query(
      `SELECT TABLE_NAME, TABLE_COLLATION, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
      [schema],
    );
    const report = buildCollationAuditReport({ schema, columnRows, tableRows, contract });
    reports.push(report);
    console.log(
      `${schema}: ${report.counts.identityMismatches} identity mismatch(es), `
      + `${report.counts.tableDefaultMismatches} table-default mismatch(es)`,
    );
  }
} finally {
  await connection.end();
}

const outputDirectory = path.join(process.cwd(), 'tmp', 'collation-audits');
await fs.mkdir(outputDirectory, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = path.join(outputDirectory, `collation-audit-${timestamp}.json`);
await fs.writeFile(outputPath, `${JSON.stringify({ contract, reports }, null, 2)}\n`, 'utf8');
console.log(`Wrote read-only collation audit to ${outputPath}`);

if (verify && reports.some(report => !report.compliant)) process.exitCode = 1;