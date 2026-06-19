import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
await conn.query("ALTER TABLE users ADD COLUMN username VARCHAR(100) NULL DEFAULT NULL UNIQUE AFTER id");
console.log('✓ username column added.');
await conn.end();
