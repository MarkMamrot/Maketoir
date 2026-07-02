import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: +process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

const [rows] = await conn.execute(
  'SELECT business_id, `key`, value FROM ims_settings WHERE `key` = ?',
  ['POS_DefaultFloat']
);
console.table(rows);

const [regs] = await conn.execute(
  'SELECT id, name, location_id, default_float FROM pos_registers ORDER BY id'
);
console.table(regs);

await conn.end();
