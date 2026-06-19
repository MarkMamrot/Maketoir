import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
const [cols] = await conn.query("SHOW COLUMNS FROM users");
console.table(cols.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null, Default: c.Default })));
await conn.end();
