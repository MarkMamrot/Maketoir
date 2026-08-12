import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const [rows] = await conn.execute(
    `SELECT id, business_id, source, operation, severity, status, title, message, last_seen_at
     FROM runtime_issues
     WHERE source LIKE '%reset%'
        OR operation LIKE '%reset%'
        OR title LIKE '%reset%'
        OR message LIKE '%reset%'
        OR source LIKE '%purchase%'
        OR operation LIKE '%purchase%'
        OR title LIKE '%purchase order%'
        OR message LIKE '%purchase order%'
     ORDER BY last_seen_at DESC
     LIMIT 500`
  );

  console.log(JSON.stringify({ count: rows.length, rows }, null, 2));
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
