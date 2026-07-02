import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: +process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

// Check what NOW() returns (server TZ)
const [[nowRow]] = await conn.execute('SELECT NOW() AS now_utc, CURDATE() AS curdate');
console.log('MySQL NOW():', nowRow);

// Check recent pos_sales
const [recent] = await conn.execute(
  `SELECT id, business_id, location_id, status, sale_type, total, created_at
   FROM pos_sales
   ORDER BY created_at DESC
   LIMIT 10`
);
console.log('\nRecent pos_sales:');
console.table(recent);

// Check what the dashboard query returns (days=1)
const [todayRows] = await conn.execute(
  `SELECT COUNT(*) AS cnt, SUM(ps.total) AS total_sum,
          MIN(ps.created_at) AS earliest, MAX(ps.created_at) AS latest,
          ps.business_id
   FROM pos_sales ps
   WHERE ps.status = 'completed'
     AND ps.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
   GROUP BY ps.business_id`
);
console.log('\nLast 24h completed sales (DATE_SUB NOW):');
console.table(todayRows);

// Check using AEST date
const aestToday = new Date().toLocaleDateString('sv-SE', { timeZone: 'Australia/Sydney' });
const [aestRows] = await conn.execute(
  `SELECT COUNT(*) AS cnt, SUM(ps.total) AS total_sum,
          MIN(ps.created_at) AS earliest, MAX(ps.created_at) AS latest,
          ps.business_id
   FROM pos_sales ps
   WHERE ps.status = 'completed'
     AND DATE(ps.created_at) = ?
   GROUP BY ps.business_id`,
  [aestToday]
);
console.log(`\nAEST today (${aestToday}) sales:`);
console.table(aestRows);

// Check business_ids present in pos_sales vs ims_locations
const [bizIds] = await conn.execute(
  `SELECT DISTINCT business_id FROM pos_sales ORDER BY business_id LIMIT 10`
);
console.log('\nDistinct business_ids in pos_sales:');
console.table(bizIds);

await conn.end();
