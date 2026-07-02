import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: +process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

const [cols1] = await conn.execute('DESCRIBE pos_register_sessions');
console.log('pos_register_sessions:');
console.table(cols1);

const [cols2] = await conn.execute('DESCRIBE pos_eod_reconciliations');
console.log('\npos_eod_reconciliations:');
console.table(cols2);

// Show today's sessions
const tz = 'Australia/Sydney';
const today = new Date().toLocaleDateString('sv-SE', { timeZone: tz });
const [sessions] = await conn.execute(
  `SELECT prs.*, pr.name AS register_name, l.name AS location_name
   FROM pos_register_sessions prs
   JOIN pos_registers pr ON pr.id = prs.register_id
   JOIN ims_locations l ON l.id = prs.location_id
   WHERE DATE(prs.opened_at) = ? OR prs.status = 'open'
   ORDER BY prs.opened_at DESC LIMIT 10`,
  [today]
);
console.log(`\nToday's register sessions (${today}):`);
console.table(sessions);

// EOD reconciliations for today
const [eod] = await conn.execute(
  `SELECT * FROM pos_eod_reconciliations WHERE reconciliation_date = ? LIMIT 20`,
  [today]
);
console.log('\nEOD reconciliations today:');
console.table(eod);

await conn.end();
