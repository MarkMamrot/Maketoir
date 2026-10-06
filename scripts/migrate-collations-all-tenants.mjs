/**
 * Read-only collation audit and verification foundation.
 * Audit all tenants: node scripts/migrate-collations-all-tenants.mjs --audit
 * Audit one tenant: node scripts/migrate-collations-all-tenants.mjs --audit --schema=readyedu_ExampleIMS
 * Run data preflights: append --preflight to a one-tenant audit
 * Generate reviewed DDL: node scripts/migrate-collations-all-tenants.mjs --plan --schema=readyedu_ExampleIMS
 * Verify contract: node scripts/migrate-collations-all-tenants.mjs --verify [--schema=...]
 * Apply to sandbox only: requires reviewed hashes, backup reference, maintenance confirmation, and confirmation token
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

import { buildCollationAuditReport, validateCollationContract } from './lib/collation-audit.mjs';
import {
  applyCollationMigrationPlan,
  loadJournaledCollationPlan,
  validateApplyRequest,
} from './lib/collation-apply.mjs';
import { buildCollationMigrationPlan } from './lib/collation-plan.mjs';

const valueOptions = [
  '--schema=',
  '--metadata-hash=',
  '--plan-hash=',
  '--confirm=',
  '--backup-reference=',
  '--lock-wait-seconds=',
];
const supportedFlags = new Set([
  '--audit',
  '--verify',
  '--preflight',
  '--plan',
  '--apply',
  '--resume',
  '--maintenance-confirmed',
]);
const positionalFlags = process.argv.slice(2).filter(argument =>
  !valueOptions.some(prefix => argument.startsWith(prefix)),
);
const unsupportedFlags = positionalFlags.filter(argument => !supportedFlags.has(argument));
if (unsupportedFlags.length > 0) throw new Error(`Unsupported option(s): ${unsupportedFlags.join(', ')}`);
const modes = ['--audit', '--verify', '--plan', '--apply', '--resume'].filter(flag => process.argv.includes(flag));
if (modes.length > 1) {
  throw new Error('Choose one of --audit, --verify, --plan, --apply, or --resume.');
}

const verify = process.argv.includes('--verify');
const plan = process.argv.includes('--plan');
const apply = process.argv.includes('--apply');
const resume = process.argv.includes('--resume');
const generatePlan = plan || apply;
const preflight = process.argv.includes('--preflight') || generatePlan || resume;
const argumentValue = name => process.argv
  .find(argument => argument.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const requestedSchema = process.argv.find(argument => argument.startsWith('--schema='))?.slice('--schema='.length);
const reviewedMetadataHash = argumentValue('metadata-hash');
const reviewedPlanHash = argumentValue('plan-hash');
const confirmation = argumentValue('confirm');
const backupReference = argumentValue('backup-reference');
const lockWaitSeconds = Number(argumentValue('lock-wait-seconds') ?? 10);
const maintenanceConfirmed = process.argv.includes('--maintenance-confirmed');
const identifierPattern = /^[A-Za-z0-9_]+$/;
if (requestedSchema && !identifierPattern.test(requestedSchema)) throw new Error('Requested schema is invalid.');
if (preflight && !requestedSchema) throw new Error('--preflight requires one explicit --schema.');
if ((apply || resume) && (!reviewedMetadataHash || !reviewedPlanHash || !confirmation || !backupReference)) {
  throw new Error('--apply/--resume requires --metadata-hash, --plan-hash, --confirm, and --backup-reference.');
}

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
const quoteIdentifier = identifier => {
  if (!identifierPattern.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `\`${identifier}\``;
};

async function runDataPreflights(connection, schema, expectedBusinessId, columnRows, tableRows) {
  const availableColumns = new Set(columnRows.map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  const availableTables = new Set(tableRows.map(row => String(row.TABLE_NAME)));
  const ownershipChecks = [];
  const businessTables = [...new Set(
    columnRows.filter(row => row.COLUMN_NAME === 'business_id').map(row => String(row.TABLE_NAME)),
  )].sort();
  if (!expectedBusinessId) {
    ownershipChecks.push({
      table: null,
      status: 'missing_registered_owner',
      exactMismatches: 0,
      caseOnlyMismatches: 0,
    });
  } else {
    for (const table of businessTables) {
      const [rows] = await connection.query(
        `SELECT
           SUM(CASE WHEN BINARY business_id <> BINARY ? THEN 1 ELSE 0 END) AS exact_mismatches,
           SUM(CASE
             WHEN BINARY business_id <> BINARY ?
              AND CONVERT(business_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
                  = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci
             THEN 1 ELSE 0
           END) AS case_only_mismatches
           FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}
          WHERE business_id IS NOT NULL`,
        [expectedBusinessId, expectedBusinessId, expectedBusinessId],
      );
      ownershipChecks.push({
        table,
        status: 'ok',
        exactMismatches: Number(rows[0]?.exact_mismatches ?? 0),
        caseOnlyMismatches: Number(rows[0]?.case_only_mismatches ?? 0),
      });
    }
  }

  const relationshipChecks = [];
  for (const relationship of contract.relationships) {
    const parentKey = `${relationship.parentTable}.${relationship.parentColumn}`;
    const childKey = `${relationship.childTable}.${relationship.childColumn}`;
    if (!availableTables.has(relationship.parentTable)
      || !availableTables.has(relationship.childTable)
      || !availableColumns.has(parentKey)
      || !availableColumns.has(childKey)) {
      relationshipChecks.push({ ...relationship, status: 'missing_schema', exactOrphans: 0, caseOnlyMatches: 0 });
      continue;
    }
    const parentTable = `${quoteIdentifier(schema)}.${quoteIdentifier(relationship.parentTable)}`;
    const childTable = `${quoteIdentifier(schema)}.${quoteIdentifier(relationship.childTable)}`;
    const parentColumn = quoteIdentifier(relationship.parentColumn);
    const childColumn = quoteIdentifier(relationship.childColumn);
    const [rows] = await connection.query(
      `SELECT
         SUM(CASE WHEN NOT EXISTS (
           SELECT 1 FROM ${parentTable} parent_row
            WHERE BINARY parent_row.${parentColumn} = BINARY child_row.${childColumn}
         ) THEN 1 ELSE 0 END) AS exact_orphans,
         SUM(CASE WHEN NOT EXISTS (
           SELECT 1 FROM ${parentTable} parent_row
            WHERE BINARY parent_row.${parentColumn} = BINARY child_row.${childColumn}
         ) AND EXISTS (
           SELECT 1 FROM ${parentTable} parent_row
            WHERE CONVERT(parent_row.${parentColumn} USING utf8mb4) COLLATE utf8mb4_unicode_ci
                = CONVERT(child_row.${childColumn} USING utf8mb4) COLLATE utf8mb4_unicode_ci
         ) THEN 1 ELSE 0 END) AS case_only_matches
       FROM ${childTable} child_row
      WHERE child_row.${childColumn} IS NOT NULL`,
    );
    relationshipChecks.push({
      ...relationship,
      status: 'ok',
      exactOrphans: Number(rows[0]?.exact_orphans ?? 0),
      caseOnlyMatches: Number(rows[0]?.case_only_matches ?? 0),
    });
  }
  return { ownershipChecks, relationshipChecks };
}

try {
  const [businesses] = await connection.query(
    `SELECT business_id, ims_db_name, is_sandbox, automation_paused
       FROM \`${mainDatabase}\`.businesses
      WHERE ims_db_name IS NOT NULL
        AND deleted_at IS NULL
      ORDER BY ims_db_name`,
  );
  const registeredSchemas = new Set(businesses.map(row => String(row.ims_db_name)).filter(Boolean));
  const businessIdBySchema = new Map(
    businesses.map(row => [String(row.ims_db_name), String(row.business_id)]),
  );
  const businessBySchema = new Map(
    businesses.map(row => [String(row.ims_db_name), row]),
  );
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
    const preflightResults = preflight
      ? await runDataPreflights(connection, schema, businessIdBySchema.get(schema), columnRows, tableRows)
      : { ownershipChecks: [], relationshipChecks: [] };
    const report = buildCollationAuditReport({
      schema,
      columnRows,
      tableRows,
      contract,
      ...preflightResults,
      preflightRun: preflight,
    });
    if (generatePlan) {
      if (!report.preflightPassed) throw new Error(`${schema} has blocking collation preflight issues.`);
      const changedTables = [...new Set([
        ...report.identityMismatches.map(mismatch => mismatch.table),
        ...report.tableDefaultMismatches.map(mismatch => mismatch.table),
      ])].sort();
      const createStatements = {};
      for (const table of changedTables) {
        const [rows] = await connection.query(
          `SHOW CREATE TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
        );
        createStatements[table] = rows[0]?.['Create Table'];
      }
      const [foreignKeyRows] = await connection.query(
        `SELECT
           kcu.CONSTRAINT_NAME,
           kcu.TABLE_NAME,
           kcu.COLUMN_NAME,
           kcu.REFERENCED_TABLE_NAME,
           kcu.REFERENCED_COLUMN_NAME,
           kcu.ORDINAL_POSITION,
           rc.UPDATE_RULE,
           rc.DELETE_RULE
         FROM information_schema.KEY_COLUMN_USAGE kcu
         JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
           ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
          AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
          AND rc.TABLE_NAME = kcu.TABLE_NAME
        WHERE kcu.CONSTRAINT_SCHEMA = ?
          AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
        [schema],
      );
      report.migrationPlan = buildCollationMigrationPlan({
        schema,
        report,
        createStatements,
        foreignKeyRows,
        contract,
      });
    }
    if (resume) {
      report.migrationPlan = await loadJournaledCollationPlan(connection, schema, reviewedPlanHash);
    }
    if (apply || resume) {
      const business = businessBySchema.get(schema);
      if (Number(business?.is_sandbox ?? 0) !== 1) {
        throw new Error('Apply mode is currently restricted to registered sandbox tenants.');
      }
      if (Number(business?.automation_paused ?? 0) !== 1) {
        throw new Error('Sandbox automation_paused must be enabled before apply.');
      }
      validateApplyRequest({
        schema,
        plan: report.migrationPlan,
        expectedMetadataHash: reviewedMetadataHash,
        expectedPlanHash: reviewedPlanHash,
        confirmation,
        backupReference,
        maintenanceConfirmed,
      });
      const lockName = `solvantis:collation:${schema}`;
      const [lockRows] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
      if (Number(lockRows[0]?.acquired) !== 1) throw new Error('Another collation migration holds the schema lock.');
      try {
        const [transactionRows] = await connection.query(
          `SELECT COUNT(*) AS active_transactions
             FROM information_schema.INNODB_TRX
            WHERE trx_mysql_thread_id <> CONNECTION_ID()`,
        );
        if (Number(transactionRows[0]?.active_transactions ?? 0) !== 0) {
          throw new Error('Active database transactions remain; apply is blocked.');
        }
        report.applyResult = await applyCollationMigrationPlan({
          connection,
          schema,
          plan: report.migrationPlan,
          contract,
          backupReference,
          lockWaitSeconds,
        });
        console.log(`${schema}: migration applied ${JSON.stringify(report.applyResult)}`);
      } finally {
        await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
      }
    }
    reports.push(report);
    console.log(
      `${schema}: ${report.counts.identityMismatches} identity mismatch(es), `
      + `${report.counts.tableDefaultMismatches} table-default mismatch(es), `
      + `${report.counts.ownershipMismatches} ownership issue(s), `
      + `${report.counts.relationshipIssues} relationship issue(s)`,
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

for (const report of reports) {
  if (!report.migrationPlan) continue;
  const planPath = path.join(outputDirectory, `collation-plan-${report.schema}-${timestamp}.sql`);
  const header = [
    '-- REVIEW ONLY: this file was generated read-only and has not been executed.',
    `-- Schema: ${report.schema}`,
    `-- Contract version: ${report.migrationPlan.contractVersion}`,
    `-- Source metadata hash: ${report.migrationPlan.sourceMetadataHash}`,
    `-- Plan hash: ${report.migrationPlan.planHash}`,
    '',
  ].join('\n');
  await fs.writeFile(
    planPath,
    `${header}${report.migrationPlan.statements.join('\n\n')}\n`,
    'utf8',
  );
  console.log(`Wrote unexecuted DDL plan to ${planPath}`);
}

if (verify && reports.some(report => !report.compliant)) process.exitCode = 1;