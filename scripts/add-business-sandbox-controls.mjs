/**
 * Add sandbox identity and the global scheduled-automation pause to businesses.
 * Safe to run repeatedly against the main database.
 *
 * Usage: node scripts/add-business-sandbox-controls.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const columns = [
  {
    name: 'is_sandbox',
    definition: 'TINYINT(1) NOT NULL DEFAULT 0 COMMENT "Marks a non-production tenant"',
  },
  {
    name: 'automation_paused',
    definition: 'TINYINT(1) NOT NULL DEFAULT 0 COMMENT "Excludes the tenant from shared schedulers"',
  },
];

try {
  for (const column of columns) {
    const [rows] = await connection.execute(
      `SELECT COUNT(*) AS count
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'businesses'
          AND COLUMN_NAME = ?`,
      [column.name],
    );

    if (Number(rows[0]?.count ?? 0) === 0) {
      await connection.execute(
        `ALTER TABLE businesses ADD COLUMN ${column.name} ${column.definition}`,
      );
      console.log(`Added businesses.${column.name}`);
    } else {
      console.log(`Already exists: businesses.${column.name}`);
    }
  }
} finally {
  await connection.end();
}
