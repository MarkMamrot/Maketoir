import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: +process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

const BIZ = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const tz  = 'Australia/Sydney';
const todayAEST = new Date().toLocaleDateString('sv-SE', { timeZone: tz });
const cutoff = `${todayAEST} 00:00:00`;
console.log('AEST today cutoff:', cutoff);

const [rows] = await conn.execute(
  `SELECT l.name AS location_name, SUM(ps.total) AS total, COUNT(*) AS cnt
   FROM pos_sales ps
   JOIN ims_locations l ON l.id = ps.location_id AND l.business_id = ?
   WHERE ps.status = 'completed'
     AND ps.created_at >= ?
   GROUP BY l.id, l.name`,
  [BIZ, cutoff]
);
console.log('\nToday\'s sales by location (new query):');
console.table(rows);

await conn.end();
