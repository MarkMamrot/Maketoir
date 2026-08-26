import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runImsForBusiness } from '../src/lib/db/BusinessRegistry';
import { getIMSPool } from '../src/services/IMSMySQLService';
import {
  parseCommunications,
  parseCustomerRequests,
  parseDiscrepancies,
  parseIncidents,
  parseSafeReferences,
  parseStartEndTasks,
  parseStoreNeeds,
  parseWeekly,
  sourceChecksum,
  type ImportedRecord,
  type ImportedTask,
} from '../src/lib/pos/daybookImport';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(root, 'docs', 'help', 'setup', 'csv daily file newtown');
const args = new Map(process.argv.slice(2).map(argument => {
  const [key, ...value] = argument.split('=');
  return [key, value.join('=') || 'true'];
}));

if (args.has('--help')) {
  console.log('Usage: npx tsx scripts/import-monsterthreads-newtown-daybook.ts --parse-only | --business-id=<id> (--location-id=<id> | --location-code=<code>) [--apply --confirm=IMPORT-NEWTOWN]');
  process.exit(0);
}

const businessId = String(args.get('--business-id') ?? '').trim();
const locationIdArg = Number(args.get('--location-id') ?? 0);
const locationCode = String(args.get('--location-code') ?? '').trim();
const apply = args.get('--apply') === 'true';
const parseOnly = args.get('--parse-only') === 'true';
if (!parseOnly && (!businessId || (!locationIdArg && !locationCode))) throw new Error('Explicit --business-id and --location-id or --location-code are required.');
if (apply && args.get('--confirm') !== 'IMPORT-NEWTOWN') throw new Error('Apply mode requires --confirm=IMPORT-NEWTOWN.');

async function main() {
const names = await fs.readdir(sourceDirectory);
const sourceFiles = await Promise.all(names.filter(name => name.toLowerCase().endsWith('.csv')).map(async name => ({ name, text: await fs.readFile(path.join(sourceDirectory, name), 'utf8') })));
const byName = (part: string) => sourceFiles.find(file => file.name.includes(part))?.text ?? '';
if (sourceFiles.length !== 8) throw new Error(`Expected 8 Newtown CSV files, found ${sourceFiles.length}.`);

const startEnd = parseStartEndTasks(byName('START_END'));
const weekly = parseWeekly(byName('WEEKLY CLEANING'));
const communications = parseCommunications(byName('COMMUNICATIONS'));
const safeReferences = parseSafeReferences(byName('REFERENCES'));
const records: ImportedRecord[] = [
  ...parseCustomerRequests(byName('CUSTOMER REQUESTS')),
  ...parseStoreNeeds(byName('STORE NEEDS')),
  ...parseDiscrepancies(byName('STOCK DISCREPANCIES')),
  ...parseIncidents(byName('INCIDENT REPORTS')),
];
const tasks = [...startEnd.tasks, ...weekly.tasks];
const references = [...safeReferences.references, ...weekly.references];
const checksum = sourceChecksum(sourceFiles);

const summary = {
  sourceFiles: sourceFiles.length,
  tasks: tasks.length,
  taskSignoffs: tasks.reduce((count, task) => count + task.signoffs.length, 0),
  communicationsFrom2026: communications.records.length,
  communicationsSkippedBefore2026: communications.skippedBefore2026,
  communicationReads: communications.records.reduce((count, item) => count + item.reads.length, 0),
  customerRequests: records.filter(record => record.type === 'customer_request').length,
  storeNeeds: records.filter(record => record.type === 'store_need').length,
  stockDiscrepancies: records.filter(record => record.type === 'stock_discrepancy').length,
  incidents: records.filter(record => record.type === 'incident').length,
  safeReferences: references.length,
  credentialRowsRejected: safeReferences.rejectedRows,
  checklistSecretsRedacted: startEnd.redactions,
  productGuides: weekly.guides.length,
  checksum,
};
if (parseOnly) {
  console.log(JSON.stringify({ mode: 'parse-only', ...summary }, null, 2));
  return;
}

function staffName(initials: string) {
  const namesByInitials: Record<string, string> = { HG: 'Holly', LM: 'Lucinda', LIZ: 'Liz', EH: 'Liz', AP: 'Anouk', SR: 'Stefania', TN: 'Historical staff', IMP: 'Spreadsheet import' };
  return namesByInitials[initials.toUpperCase()] ?? `Imported staff (${initials.toUpperCase()})`;
}

await runImsForBusiness(businessId, async () => {
  const pool = getIMSPool();
  const connection = await pool.getConnection();
  try {
    const [locations] = await connection.execute(
      locationIdArg
        ? 'SELECT id, name FROM ims_locations WHERE business_id = ? AND id = ? AND is_active = 1 LIMIT 1'
        : 'SELECT id, name FROM ims_locations WHERE business_id = ? AND code = ? AND is_active = 1 LIMIT 1',
      [businessId, locationIdArg || locationCode],
    ) as any;
    const location = locations[0];
    if (!location) throw new Error('The requested active Newtown location was not found for this business.');
    if (!/newtown/i.test(location.name) && args.get('--allow-non-newtown') !== 'true') throw new Error(`Refusing to import into non-Newtown location '${location.name}'.`);

    const [schemaRows] = await connection.execute(
      `SELECT COUNT(*) AS count FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'pos_daybook_import_runs'`,
    ) as any;
    if (!Number(schemaRows[0]?.count)) throw new Error('Store Daybook schema is not deployed for this tenant. Run the all-tenant catch-up first.');

    const [existing] = await connection.execute(
      'SELECT id, created_at FROM pos_daybook_import_runs WHERE business_id = ? AND location_id = ? AND source_checksum = ? LIMIT 1',
      [businessId, location.id, checksum],
    ) as any;
    const report = { mode: apply ? 'apply' : 'dry-run', businessId, location: { id: Number(location.id), name: location.name }, alreadyImported: Boolean(existing[0]), ...summary };
    console.log(JSON.stringify(report, null, 2));
    if (!apply || existing[0]) return;

    await connection.beginTransaction();
    const staffIds = new Map<string, number>();
    async function ensureStaff(code: string) {
      const normalized = code.toUpperCase() || 'IMP';
      if (staffIds.has(normalized)) return staffIds.get(normalized)!;
      await connection.execute(
        `INSERT INTO pos_daybook_staff_identities (business_id, location_id, name, initials)
         VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
        [businessId, location.id, staffName(normalized), normalized],
      );
      const [rows] = await connection.execute(
        'SELECT id FROM pos_daybook_staff_identities WHERE business_id = ? AND location_id = ? AND initials = ? LIMIT 1',
        [businessId, location.id, normalized],
      ) as any;
      const id = Number(rows[0].id); staffIds.set(normalized, id); return id;
    }

    async function importTask(task: ImportedTask) {
      const [found] = await connection.execute(
        `SELECT id FROM pos_daybook_task_templates
         WHERE business_id = ? AND location_id = ? AND phase = ? AND title = ? AND recurrence = ? AND weekday <=> ? LIMIT 1`,
        [businessId, location.id, task.phase, task.title, task.recurrence, task.weekday ?? null],
      ) as any;
      let templateId = Number(found[0]?.id ?? 0);
      if (!templateId) {
        const [result] = await connection.execute(
          `INSERT INTO pos_daybook_task_templates
             (business_id, location_id, phase, title, recurrence, weekday, created_by_name)
           VALUES (?, ?, ?, ?, ?, ?, 'Newtown spreadsheet import')`,
          [businessId, location.id, task.phase, task.title, task.recurrence, task.weekday ?? null],
        ) as any;
        templateId = Number(result.insertId);
      }
      for (const signoff of task.signoffs) {
        const [instanceResult] = await connection.execute(
          `INSERT INTO pos_daybook_task_instances
             (business_id, location_id, task_date, template_id, title_snapshot, phase, status, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, 'completed', CONCAT(?, ' 12:00:00'))
           ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
          [businessId, location.id, signoff.date, templateId, task.title, task.phase, signoff.date],
        ) as any;
        const instanceId = Number(instanceResult.insertId);
        const identityId = await ensureStaff(signoff.initials);
        await connection.execute(
          `INSERT INTO pos_daybook_task_signoffs
             (business_id, instance_id, action, staff_identity_id, staff_name, staff_initials, actor_name, actor_tier, created_at)
           VALUES (?, ?, 'completed', ?, ?, ?, 'Newtown spreadsheet import', 'Import', CONCAT(?, ' 12:00:00'))`,
          [businessId, instanceId, identityId, staffName(signoff.initials), signoff.initials, signoff.date],
        );
      }
    }
    for (const task of tasks) await importTask(task);

    for (const communication of communications.records) {
      const title = communication.message.split(/\r?\n|[.!?]/)[0].trim().slice(0, 120) || 'Store update';
      const [result] = await connection.execute(
        `INSERT INTO pos_daybook_communications
           (business_id, title, message, published_at, author_name, import_key)
         VALUES (?, ?, ?, CONCAT(?, ' 09:00:00'), 'Newtown spreadsheet import', ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [businessId, title, communication.message, communication.date, communication.importKey],
      ) as any;
      const communicationId = Number(result.insertId);
      await connection.execute(
        `INSERT IGNORE INTO pos_daybook_communication_targets (business_id, communication_id, location_id) VALUES (?, ?, ?)`,
        [businessId, communicationId, location.id],
      );
      for (const read of communication.reads) {
        const identityId = await ensureStaff(read.initials);
        await connection.execute(
          `INSERT IGNORE INTO pos_daybook_communication_reads
             (business_id, communication_id, location_id, staff_identity_id, staff_name, staff_initials, actor_name, read_at)
           VALUES (?, ?, ?, ?, ?, ?, 'Newtown spreadsheet import', CONCAT(?, ' 12:00:00'))`,
          [businessId, communicationId, location.id, identityId, read.name || staffName(read.initials), read.initials, communication.date],
        );
      }
    }

    const [warehouseRows] = await connection.execute(
      `SELECT l.id FROM ims_settings s JOIN ims_locations l ON l.id = CAST(s.value AS UNSIGNED) AND l.business_id = s.business_id
       WHERE s.business_id = ? AND s.key = 'default_warehouse_location_id' LIMIT 1`,
      [businessId],
    ) as any;
    const warehouseId = Number(warehouseRows[0]?.id ?? 0) || null;
    for (const record of records) {
      const identityId = await ensureStaff(record.staffInitials);
      await connection.execute(
        `INSERT INTO pos_daybook_records
           (business_id, location_id, record_type, status, occurred_on, title, details_json,
            source_location_id, destination_location_id, staff_identity_id, staff_name, staff_initials,
            actor_name, import_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Newtown spreadsheet import', ?, COALESCE(CONCAT(?, ' 12:00:00'), NOW()))
         ON DUPLICATE KEY UPDATE id = id`,
        [businessId, location.id, record.type, record.type === 'store_need' ? 'requested' : 'open', record.date,
          record.title, JSON.stringify(record.details), location.id, record.type === 'store_need' ? warehouseId : null,
          identityId, staffName(record.staffInitials), record.staffInitials, record.importKey, record.date],
      );
    }

    for (const reference of references) {
      await connection.execute(
        `INSERT INTO pos_daybook_references
           (business_id, location_id, category, title, content, import_key)
         VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
        [businessId, location.id, reference.category, reference.title, reference.content, reference.importKey],
      );
    }
    for (const guide of weekly.guides) {
      await connection.execute(
        `INSERT INTO pos_daybook_product_guides
           (business_id, location_id, sku, product_name, category, shelf_location, status, import_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
        [businessId, location.id, guide.sku, guide.productName, guide.category || null, guide.shelf || null, guide.status, guide.importKey],
      );
    }

    await connection.execute(
      `INSERT INTO pos_daybook_import_runs
         (business_id, location_id, source_name, source_checksum, result_json, imported_by)
       VALUES (?, ?, 'Newtown Daily CSV export', ?, ?, 'Store Daybook importer')`,
      [businessId, location.id, checksum, JSON.stringify(summary)],
    );
    await connection.commit();
    console.log(JSON.stringify({ applied: true, locationId: Number(location.id), checksum }, null, 2));
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
});
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});