import 'dotenv/config';
import mysql from 'mysql2/promise';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = arg.match(/^--([^=]+)=(.*)$/);
  return match ? [match[1], match[2]] : [arg.replace(/^--/, ''), true];
}));

const apply = args.apply === true;
const businessId = String(args['business-id'] ?? '').trim();
const schema = String(args.schema ?? '').trim();
const confirmation = String(args.confirm ?? '').trim();

if (!businessId) throw new Error('Missing --business-id');
if (!/^[A-Za-z0-9_]{1,64}$/.test(schema)) throw new Error('Missing or invalid --schema');
if (confirmation !== `DELETE ${businessId} ${schema}`) {
  throw new Error(`Confirmation must be exactly: DELETE ${businessId} ${schema}`);
}

const config = (database) => ({
  host: process.env.IMS_MYSQL_HOST ?? process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database,
});
const mainDb = String(process.env.MYSQL_DATABASE ?? '');
if (!/^[A-Za-z0-9_]{1,64}$/.test(mainDb)) throw new Error('Invalid MYSQL_DATABASE');

const main = await mysql.createConnection(config(mainDb));
const server = await mysql.createConnection(config());
try {
  const [rows] = await main.execute(
    `SELECT business_id, name, ims_db_name, is_sandbox, automation_paused, deleted_at
       FROM businesses WHERE business_id = ? LIMIT 1`,
    [businessId],
  );
  const business = rows[0];
  if (!business) throw new Error(`Business not found: ${businessId}`);
  if (Number(business.is_sandbox) !== 1 || Number(business.automation_paused) !== 1) {
    throw new Error('Refusing cleanup: target is not both sandbox and automation-paused');
  }
  if (String(business.ims_db_name ?? '') !== schema) {
    throw new Error(`Refusing cleanup: registry schema is ${business.ims_db_name ?? '(none)'}`);
  }

  const [references] = await main.execute(
    `SELECT COUNT(*) AS count FROM businesses
      WHERE ims_db_name = ? AND business_id <> ? AND deleted_at IS NULL`,
    [schema, businessId],
  );
  if (Number(references[0]?.count ?? 0) !== 0) {
    throw new Error('Refusing cleanup: another active business references the schema');
  }

  const plan = {
    businessId,
    name: business.name,
    schema,
    automationPaused: true,
    actions: ['delete target users', 'delete target connections', 'delete target main-DB business rows', 'drop target IMS schema'],
  };
  console.log(JSON.stringify(plan, null, 2));
  if (!apply) {
    console.log('DRY RUN COMPLETE. Re-run with --apply to execute this exact cleanup.');
    process.exit(0);
  }

  await server.query(`DROP DATABASE IF EXISTS \`${schema}\``);

  await main.beginTransaction();
  try {
    const [tables] = await main.execute(
      `SELECT TABLE_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'business_id'
        GROUP BY TABLE_NAME`,
    );
    const tableNames = tables.map((row) => String(row.TABLE_NAME));
    const ordered = [
      ...tableNames.filter((table) => !['businesses', 'users', 'connections'].includes(table)),
      ...['users', 'connections'].filter((table) => tableNames.includes(table)),
    ];
    await main.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of ordered) {
      if (!/^[A-Za-z0-9_]{1,64}$/.test(table)) throw new Error(`Unsafe table name: ${table}`);
      await main.execute(`DELETE FROM \`${table}\` WHERE business_id = ?`, [businessId]);
    }
    await main.execute('DELETE FROM businesses WHERE business_id = ?', [businessId]);
    await main.query('SET FOREIGN_KEY_CHECKS = 1');
    await main.commit();
  } catch (error) {
    await main.rollback();
    await main.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => undefined);
    throw error;
  }

  console.log('Sandbox cleanup complete.');
} finally {
  await main.end();
  await server.end();
}
