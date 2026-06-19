import 'dotenv/config';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectionLimit: 1,
});

try {
  const [rows] = await pool.execute('SELECT 1 AS ok');
  console.log('DB connection OK:', rows[0]);
  const [tbls] = await pool.execute('SHOW TABLES');
  console.log('Table count:', tbls.length);
  console.log('Tables:', tbls.map(t => Object.values(t)[0]).join(', '));
  await pool.end();
} catch (e) {
  console.error('DB ERROR:', e.message);
  console.error('Code:', e.code);
  process.exit(1);
}
