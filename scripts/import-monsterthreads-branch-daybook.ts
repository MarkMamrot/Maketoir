import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runImsForBusiness } from '../src/lib/db/BusinessRegistry';
import { getIMSPool } from '../src/services/IMSMySQLService';
import {
  parseBranchCommunications,
  parseBranchCustomerRequests,
  parseBranchDailyTasks,
  parseBranchDiscrepancies,
  parseBranchSafeReferences,
  parseBranchStartEndTasks,
  parseBranchStoreNeeds,
  parseStorageMap,
  sourceChecksum,
  type ImportedRecord,
  type ImportedTask,
} from '../src/lib/pos/daybookImport';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(process.argv.slice(2).map(argument => {
  const [key, ...value] = argument.split('=');
  return [key, value.join('=') || 'true'];
}));
const branch = String(args.get('--branch') ?? '').trim().toLowerCase();
const branchConfig = branch === 'qv' ? {
  displayName: 'QV', expectedLocation: /^QV Shop$/i, expectedFiles: 7,
  sourceDirectory: path.join(root, 'docs', 'help', 'setup', 'csv daily file newtown', 'qv files'),
} : branch === 'qvb' ? {
  displayName: 'QVB', expectedLocation: /^QVB Shop$/i, expectedFiles: 8,
  sourceDirectory: path.join(root, 'docs', 'help', 'setup', 'QVB Daily files'),
} : null;

if (args.has('--help')) {
  console.log('Usage: npx tsx scripts/import-monsterthreads-branch-daybook.ts --branch=qv|qvb --parse-only | --business-id=<id> --location-id=<id> [--apply --confirm=IMPORT-QV|IMPORT-QVB]');
  process.exit(0);
}
if (!branchConfig) throw new Error('Explicit --branch=qv or --branch=qvb is required.');
const businessId = String(args.get('--business-id') ?? '').trim();
const locationId = Number(args.get('--location-id') ?? 0);
const parseOnly = args.get('--parse-only') === 'true';
const apply = args.get('--apply') === 'true';
if (!parseOnly && (!businessId || !Number.isInteger(locationId) || locationId <= 0)) throw new Error('Explicit --business-id and --location-id are required.');
if (apply && args.get('--confirm') !== `IMPORT-${branchConfig.displayName}`) throw new Error(`Apply mode requires --confirm=IMPORT-${branchConfig.displayName}.`);

function fileBy(sourceFiles: { name: string; text: string }[], pattern: RegExp) {
  return sourceFiles.find(file => pattern.test(file.name))?.text ?? '';
}

async function main() {
  const names = await fs.readdir(branchConfig.sourceDirectory);
  const sourceFiles = await Promise.all(names.filter(name => name.toLowerCase().endsWith('.csv')).map(async name => ({ name, text: await fs.readFile(path.join(branchConfig.sourceDirectory, name), 'utf8') })));
  if (sourceFiles.length !== branchConfig.expectedFiles) throw new Error(`Expected ${branchConfig.expectedFiles} ${branchConfig.displayName} CSV files, found ${sourceFiles.length}.`);

  const startEnd = parseBranchStartEndTasks(fileBy(sourceFiles, /start.*end/i));
  const dailyTasks = parseBranchDailyTasks(fileBy(sourceFiles, /daily jobs|daily tasks/i));
  const communications = parseBranchCommunications(fileBy(sourceFiles, /communication|comms/i), branch);
  const records: ImportedRecord[] = [
    ...parseBranchCustomerRequests(fileBy(sourceFiles, /customer requests|cust\. requests/i), branch),
    ...parseBranchStoreNeeds(fileBy(sourceFiles, /store needs/i), branch),
    ...parseBranchDiscrepancies(fileBy(sourceFiles, /stock discrepancies/i), branch),
  ];
  const safeReferences = parseBranchSafeReferences(fileBy(sourceFiles, /reference/i), branch);
  const guides = branch === 'qvb' ? parseStorageMap(fileBy(sourceFiles, /storage map/i), branch) : [];
  const tasks = [...startEnd.tasks, ...dailyTasks];
  const checksum = sourceChecksum(sourceFiles);
  const summary = {
    sourceFiles: sourceFiles.length,
    tasks: tasks.length,
    taskSignoffs: tasks.reduce((count, task) => count + task.signoffs.length, 0),
    communications: communications.records.length,
    communicationsSkippedBefore2026: communications.skippedBefore2026,
    communicationRedactions: communications.redactions,
    communicationReads: communications.records.reduce((count, item) => count + item.reads.length, 0),
    customerRequests: records.filter(record => record.type === 'customer_request').length,
    storeNeeds: records.filter(record => record.type === 'store_need').length,
    stockDiscrepancies: records.filter(record => record.type === 'stock_discrepancy').length,
    safeReferences: safeReferences.references.length,
    credentialRowsRejected: safeReferences.rejectedRows,
    checklistSecretsRedacted: startEnd.redactions,
    storageGuides: guides.length,
    checksum,
  };
  if (parseOnly) {
    console.log(JSON.stringify({ mode: 'parse-only', branch: branchConfig.displayName, ...summary }, null, 2));
    return;
  }

  await runImsForBusiness(businessId, async () => {
    const connection = await getIMSPool().getConnection();
    try {
      const [locationRows] = await connection.execute(
        'SELECT id, name FROM ims_locations WHERE business_id = ? AND id = ? AND is_active = 1 LIMIT 1',
        [businessId, locationId],
      ) as any;
      const location = locationRows[0];
      if (!location || !branchConfig.expectedLocation.test(location.name)) throw new Error(`Location ${locationId} is not the active ${branchConfig.displayName} branch.`);
      const [existingRows] = await connection.execute(
        'SELECT id FROM pos_daybook_import_runs WHERE business_id = ? AND location_id = ? AND source_checksum = ? LIMIT 1',
        [businessId, locationId, checksum],
      ) as any;
      console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', businessId, location: { id: locationId, name: location.name }, alreadyImported: Boolean(existingRows[0]), ...summary }, null, 2));
      if (!apply || existingRows[0]) return;

      await connection.beginTransaction();
      const staffIds = new Map<string, number>();
      async function ensureStaff(rawInitials: string) {
        const staffInitials = rawInitials.toUpperCase() || 'IMP';
        if (staffIds.has(staffInitials)) return staffIds.get(staffInitials)!;
        const staffName = staffInitials === 'IMP' ? 'Spreadsheet import' : `Imported staff (${staffInitials})`;
        await connection.execute(
          `INSERT INTO pos_daybook_staff_identities (business_id, location_id, name, initials)
           VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE is_active = 1`,
          [businessId, locationId, staffName, staffInitials],
        );
        const [rows] = await connection.execute(
          'SELECT id FROM pos_daybook_staff_identities WHERE business_id = ? AND location_id = ? AND initials = ? LIMIT 1',
          [businessId, locationId, staffInitials],
        ) as any;
        const id = Number(rows[0].id); staffIds.set(staffInitials, id); return id;
      }

      async function importTask(task: ImportedTask) {
        const title = task.title.slice(0, 255); const instructions = task.title.length > 255 ? task.title : null;
        const [found] = await connection.execute(
          `SELECT id FROM pos_daybook_task_templates
           WHERE business_id = ? AND location_id = ? AND phase = ? AND title = ? AND recurrence = ? AND weekday <=> ? LIMIT 1`,
          [businessId, locationId, task.phase, title, task.recurrence, task.weekday ?? null],
        ) as any;
        let templateId = Number(found[0]?.id ?? 0);
        if (!templateId) {
          const [result] = await connection.execute(
            `INSERT INTO pos_daybook_task_templates
               (business_id, location_id, phase, title, instructions, recurrence, weekday, created_by_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [businessId, locationId, task.phase, title, instructions, task.recurrence, task.weekday ?? null, `${branchConfig.displayName} spreadsheet import`],
          ) as any;
          templateId = Number(result.insertId);
        }
        for (const signoff of task.signoffs) {
          const [instanceResult] = await connection.execute(
            `INSERT INTO pos_daybook_task_instances
               (business_id, location_id, task_date, template_id, title_snapshot, instructions_snapshot, phase, status, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', CONCAT(?, ' 12:00:00'))
             ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), status = 'completed', completed_at = COALESCE(completed_at, VALUES(completed_at))`,
            [businessId, locationId, signoff.date, templateId, title, instructions, task.phase, signoff.date],
          ) as any;
          const instanceId = Number(instanceResult.insertId); const identityId = await ensureStaff(signoff.initials);
          await connection.execute(
            `INSERT INTO pos_daybook_task_signoffs
               (business_id, instance_id, action, staff_identity_id, staff_name, staff_initials, actor_name, actor_tier, created_at)
             SELECT ?, ?, 'completed', ?, ?, ?, ?, 'Import', CONCAT(?, ' 12:00:00')
             WHERE NOT EXISTS (SELECT 1 FROM pos_daybook_task_signoffs WHERE business_id = ? AND instance_id = ? AND action = 'completed' AND staff_initials = ?)`,
            [businessId, instanceId, identityId, `Imported staff (${signoff.initials})`, signoff.initials, `${branchConfig.displayName} spreadsheet import`, signoff.date, businessId, instanceId, signoff.initials],
          );
        }
      }
      for (const task of tasks) await importTask(task);

      for (const communication of communications.records) {
        const title = communication.message.split(/\r?\n|[.!?]/)[0].trim().slice(0, 120) || 'Store update';
        const [result] = await connection.execute(
          `INSERT INTO pos_daybook_communications (business_id, title, message, published_at, author_name, import_key)
           VALUES (?, ?, ?, CONCAT(?, ' 09:00:00'), ?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
          [businessId, title, communication.message, communication.date, `${branchConfig.displayName} spreadsheet import`, communication.importKey],
        ) as any;
        const communicationId = Number(result.insertId);
        await connection.execute('INSERT IGNORE INTO pos_daybook_communication_targets (business_id, communication_id, location_id) VALUES (?, ?, ?)', [businessId, communicationId, locationId]);
        for (const read of communication.reads) {
          const identityId = await ensureStaff(read.initials);
          await connection.execute(
            `INSERT IGNORE INTO pos_daybook_communication_reads
               (business_id, communication_id, location_id, staff_identity_id, staff_name, staff_initials, actor_name, read_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, CONCAT(?, ' 12:00:00'))`,
            [businessId, communicationId, locationId, identityId, read.name || `Imported staff (${read.initials})`, read.initials, `${branchConfig.displayName} spreadsheet import`, communication.date],
          );
        }
      }

      const [warehouseRows] = await connection.execute(
        `SELECT l.id FROM ims_settings s JOIN ims_locations l ON l.id = CAST(s.value AS UNSIGNED) AND l.business_id = s.business_id
         WHERE s.business_id = ? AND s.key = 'default_warehouse_location_id' LIMIT 1`, [businessId],
      ) as any;
      const warehouseId = Number(warehouseRows[0]?.id ?? 0) || null;
      for (const record of records) {
        const identityId = await ensureStaff(record.staffInitials);
        await connection.execute(
          `INSERT INTO pos_daybook_records
             (business_id, location_id, record_type, status, occurred_on, title, details_json, source_location_id,
              destination_location_id, staff_identity_id, staff_name, staff_initials, actor_name, import_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(CONCAT(?, ' 12:00:00'), NOW()))
           ON DUPLICATE KEY UPDATE id = id`,
          [businessId, locationId, record.type, record.type === 'store_need' ? 'requested' : 'open', record.date,
            record.title, JSON.stringify(record.details), locationId, record.type === 'store_need' ? warehouseId : null,
            identityId, `Imported staff (${record.staffInitials})`, record.staffInitials,
            `${branchConfig.displayName} spreadsheet import`, record.importKey, record.date],
        );
      }
      for (const reference of safeReferences.references) {
        await connection.execute(
          `INSERT INTO pos_daybook_references (business_id, location_id, category, title, content, import_key)
           VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
          [businessId, locationId, reference.category, reference.title, reference.content, reference.importKey],
        );
      }
      for (const guide of guides) {
        await connection.execute(
          `INSERT INTO pos_daybook_product_guides
             (business_id, location_id, sku, product_name, category, shelf_location, status, import_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
          [businessId, locationId, guide.sku || null, guide.productName, guide.category, guide.shelf, guide.status, guide.importKey],
        );
      }
      await connection.execute(
        `INSERT INTO pos_daybook_import_runs
           (business_id, location_id, source_name, source_checksum, result_json, imported_by)
         VALUES (?, ?, ?, ?, ?, 'Store Daybook branch importer')`,
        [businessId, locationId, `${branchConfig.displayName} Daily CSV export`, checksum, JSON.stringify(summary)],
      );
      await connection.commit();
      console.log(JSON.stringify({ applied: true, branch: branchConfig.displayName, locationId, checksum }, null, 2));
    } catch (caught) {
      try { await connection.rollback(); } catch {}
      throw caught;
    } finally { connection.release(); }
  });
}

main().then(() => process.exit(0)).catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});