import 'dotenv/config';
import mysql from 'mysql2/promise';

const EXPECTED_SCHEMA = 'readyedu_MonsterthreadsIMS';
const APPLY_CONFIRMATION = 'MIGRATE-MONSTERTHREADS-DAYBOOK-COPY';
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find(argument => argument.startsWith('--confirm='))?.slice('--confirm='.length);

if (apply && confirmation !== APPLY_CONFIRMATION) {
  throw new Error(`Apply requires --confirm=${APPLY_CONFIRMATION}`);
}

const reviewedTitles = new Map([
  [19, 'Turn on all lights'],
  [21, 'Open Solvantis and register'],
  [22, 'Turn on store music'],
  [23, 'Check EFTPOS, internet and phone'],
  [24, 'Read communications'],
  [25, 'Check apparel displays'],
  [26, 'Dust displays'],
  [27, 'Restock the store'],
  [28, 'Complete daily cleaning tasks'],
  [29, 'Restock and space tee racks'],
  [30, 'Clean glass and touched surfaces'],
  [31, 'Tidy and restock the store'],
  [32, 'Restock bags, receipt rolls and bins'],
  [33, 'Vacuum or sweep the floor'],
  [34, 'Turn off air conditioning'],
  [35, 'Count cash for EOD reconciliation'],
  [36, 'Print EFTPOS reconciliation'],
  [37, 'Complete EOD reconciliation'],
  [38, 'Match Zeller and EOD card totals'],
  [39, 'Match cash takings and expected total'],
  [40, 'Check and resolve EOD variances'],
  [41, 'Send the EOD email'],
  [42, 'Complete the cash sheet'],
  [43, 'File receipts, reports and cash'],
  [44, 'Turn off display and room lights'],
  [45, 'Sign off Deputy and close the store'],
  [50, 'Check security tags on winter apparel'],
  [51, 'Get change for the week'],
  [52, 'Finish unpacking Monday delivery'],
  [54, 'Clean Izipizi glasses and check tags'],
  [57, 'Empty and clean the vacuum'],
  [95, 'Open Solvantis and register'],
  [75, 'Tidy and organise the storerooms'],
  [80, 'Check and restock the shop floor'],
  [81, 'Record missing stock'],
  [93, 'Turn on all lights'],
  [94, 'Tidy the front window'],
  [96, 'Turn on store music'],
  [100, 'Restock the shop floor'],
  [103, 'Dust the store for 15 minutes'],
  [104, 'Vacuum and spot mop the floor'],
  [106, 'Complete daily cleaning tasks'],
  [107, 'Tidy and restock the shop floor'],
  [108, 'Clean the front window'],
  [109, 'Clean mirrors, cabinets and counters'],
  [112, 'Lock up before counting cash'],
  [113, 'Open Close Register in Solvantis'],
  [114, 'Send the close-register report'],
  [115, 'Turn off equipment and lock up'],
  [116, 'Complete Start of Day jobs'],
  [117, 'Sanitise and dust touched products'],
  [120, 'Check all clothing drawers'],
  [121, 'Dust the front-half shelving'],
  [124, 'Complete outstanding weekly tasks'],
  [125, 'Complete End of Day jobs'],
  [126, 'Complete Start of Day jobs'],
  [128, 'Check shelf prices and missing labels'],
  [131, 'Complete outstanding weekly tasks'],
  [132, 'Complete End of Day jobs'],
  [133, 'Complete Start of Day jobs'],
  [134, 'Disassemble and clean the vacuum'],
  [137, 'Tidy and check all card displays'],
  [139, 'Complete outstanding weekly tasks'],
  [140, 'Complete End of Day jobs'],
  [141, 'Complete Start of Day jobs'],
  [143, 'Check that every item is priced'],
  [145, 'Clean the Izipizi glasses'],
  [148, 'Clean display mugs and ceramics'],
  [152, 'Complete outstanding weekly tasks'],
  [153, 'Clean the Orbitkey stand'],
  [154, 'Complete End of Day jobs'],
  [155, 'Complete Start of Day jobs'],
  [158, 'Check customer holds'],
  [160, 'Check shelf prices and missing labels'],
  [162, 'Complete outstanding weekly tasks'],
  [163, 'Complete End of Day jobs'],
  [164, 'Complete Start of Day jobs'],
  [166, 'Check active security tags'],
  [169, 'Dust the top shelves'],
  [171, 'Complete outstanding weekly tasks'],
  [172, 'Complete End of Day jobs'],
  [173, 'Complete Start of Day jobs'],
  [176, 'Dust the middle wooden shelves'],
  [181, 'Complete outstanding weekly tasks'],
  [182, 'Complete End of Day jobs'],
  [184, 'Turn on all lights'],
  [185, 'Open Solvantis and register'],
  [186, 'Tidy and check apparel'],
  [188, 'Complete the daily task'],
  [190, 'Update Store Needs'],
  [191, 'Update Customer Requests'],
  [201, 'Turn off speakers, lamps and lights'],
  [208, 'Dust the middle shelves and counter'],
  [211, 'Check Store Needs for tomorrow'],
  [220, 'Check Store Needs for tomorrow'],
]);

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanInstructions(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function conciseTitle(id, source) {
  const reviewed = reviewedTitles.get(Number(id));
  if (reviewed) return reviewed;
  const raw = String(source ?? '');
  const firstLine = raw.split(/\r?\n/, 1)[0].trim().replace(/[:;,.-]+$/, '');
  if (firstLine.length >= 8 && firstLine.length <= 50) return firstLine;
  const text = clean(raw);
  const prefix = text.slice(0, 51);
  const strongBoundary = /[.!?;:](?:\s|$)|\s[-–—]\s/g;
  const boundaries = [...prefix.matchAll(strongBoundary)]
    .map(match => Number(match.index) + (match[0].trim().length === 1 ? 1 : 0))
    .filter(index => index >= 16 && index <= 50);
  let boundary = boundaries[0] ?? text.slice(0, 46).lastIndexOf(' ');
  if (boundary < 16) boundary = Math.min(50, text.length);
  let title = text.slice(0, boundary).replace(/[:;,.-]+$/, '').trim();
  while (/\b(and|the|to|with|any|all|if|in|of|from|a)$/i.test(title)) title = title.replace(/\s+\S+$/, '').trim();
  return title.slice(0, 50);
}

function migrateCopy(row) {
  const originalTitle = clean(row.title);
  const originalInstructions = cleanInstructions(row.instructions);
  const legacyFullInstructions = originalInstructions.length > originalTitle.length
    && originalInstructions.startsWith(originalTitle.slice(0, Math.min(originalTitle.length, 220)));
  const source = legacyFullInstructions ? originalInstructions : originalTitle;
  const title = conciseTitle(row.id, source);
  const sourceRemainder = source.startsWith(title)
    ? source.slice(title.length).replace(/^[\s:;,.–—-]+/, '').trim()
    : source;
  const instructions = cleanInstructions([
    sourceRemainder,
    legacyFullInstructions || !originalInstructions ? '' : originalInstructions,
  ].filter(Boolean).join('\n')).slice(0, 600) || null;
  if (!title || title.length > 50 || (instructions?.length ?? 0) > 600) throw new Error(`Invalid migrated copy for task ${row.id}`);
  return { title, instructions };
}

const connection = await mysql.createConnection({
  host: process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST,
  port: Number(process.env.IMS_MYSQL_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.IMS_MYSQL_USER || process.env.MYSQL_USER,
  password: process.env.IMS_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD,
  database: EXPECTED_SCHEMA,
  connectTimeout: 20000,
});

try {
  await connection.beginTransaction();
  const [rows] = await connection.query(`
    SELECT id, business_id, location_id, title, instructions
    FROM pos_daybook_task_templates
    WHERE is_active = 1 AND CHAR_LENGTH(title) > 50
    ORDER BY location_id, id
    FOR UPDATE
  `);
  const businessIds = new Set(rows.map(row => row.business_id));
  if (businessIds.size > 1) throw new Error(`Expected one Monsterthreads business, found ${businessIds.size}`);

  let openInstances = 0;
  for (const row of rows) {
    const next = migrateCopy(row);
    console.log(`${row.location_id}/${row.id}: ${JSON.stringify(row.title)} -> ${JSON.stringify(next.title)}`);
    if (!apply) continue;
    await connection.execute(
      `UPDATE pos_daybook_task_templates SET title = ?, instructions = ?
       WHERE id = ? AND business_id = ? AND location_id = ? AND is_active = 1`,
      [next.title, next.instructions, row.id, row.business_id, row.location_id],
    );
    const [instanceResult] = await connection.execute(
      `UPDATE pos_daybook_task_instances SET title_snapshot = ?, instructions_snapshot = ?
       WHERE business_id = ? AND location_id = ? AND template_id = ? AND status = 'open'`,
      [next.title, next.instructions, row.business_id, row.location_id, row.id],
    );
    openInstances += instanceResult.affectedRows;
  }

  if (apply) {
    const [[verification]] = await connection.query(`
      SELECT SUM(CASE WHEN CHAR_LENGTH(title) > 50 THEN 1 ELSE 0 END) AS long_titles,
             SUM(CASE WHEN CHAR_LENGTH(instructions) > 600 THEN 1 ELSE 0 END) AS long_instructions
      FROM pos_daybook_task_templates WHERE is_active = 1
    `);
    if (Number(verification.long_titles) !== 0 || Number(verification.long_instructions) !== 0) {
      throw new Error(`Verification failed: ${JSON.stringify(verification)}`);
    }
    await connection.commit();
    console.log(`Applied ${rows.length} reviewed task updates and synchronized ${openInstances} open instances.`);
  } else {
    await connection.rollback();
    console.log(`Dry run only: ${rows.length} active tasks would be updated. Re-run with --apply --confirm=${APPLY_CONFIRMATION}.`);
  }
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}