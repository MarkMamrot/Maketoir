import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const [cols] = await conn.query(
  "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='users' AND COLUMN_NAME='username'"
);

if (cols.length > 0) {
  console.log('✓ username column already exists.');
} else {
  await conn.query(
    "ALTER TABLE users ADD COLUMN username VARCHAR(100) NULL DEFAULT NULL UNIQUE AFTER id"
  );
  console.log('✓ username column added with UNIQUE constraint.');
}

await conn.end();
