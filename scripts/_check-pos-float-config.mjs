import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: +process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,  // main DB
});

const [rows] = await conn.execute(
  'SELECT business_id, `key`, value FROM config WHERE `key` = ?',
  ['POS_DefaultFloat']
);
console.table(rows);

await conn.end();
