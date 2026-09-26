import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
try {
  const [rows] = await connection.query(
    `SELECT ID FROM information_schema.PROCESSLIST
      WHERE DB = 'readyedu_MonsterthreadsIMS'
        AND COMMAND <> 'Sleep'
        AND INFO LIKE 'INSERT INTO ims_sales_channel_jobs%'
        AND INFO LIKE '%ims_shopify_inventory_queue%'`,
  );
  for (const row of rows) await connection.query(`KILL QUERY ${Number(row.ID)}`);
  console.log(JSON.stringify({ stoppedQueryIds: rows.map(row => Number(row.ID)) }));
} finally {
  await connection.end();
}
