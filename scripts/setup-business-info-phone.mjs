import 'dotenv/config';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
if (!process.env.MYSQL_DATABASE) throw new Error('MYSQL_DATABASE is required.');
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
try {
  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_info' AND COLUMN_NAME = 'phone'`,
  );
  console.log(`Shared business profile phone column ${columns.length ? 'exists' : 'is missing'}.`);
  if (!apply) {
    console.log('Dry run only. Re-run with --apply. No existing profile values or tenant IMS schemas will be changed.');
  } else {
    if (!columns.length) await connection.query('ALTER TABLE business_info ADD COLUMN phone VARCHAR(50) NULL');
    const [verified] = await connection.execute(
      `SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_info' AND COLUMN_NAME = 'phone'`,
    );
    if (verified.length !== 1 || verified[0].DATA_TYPE !== 'varchar'
      || Number(verified[0].CHARACTER_MAXIMUM_LENGTH) < 50 || verified[0].IS_NULLABLE !== 'YES') {
      throw new Error('Business profile phone column does not match the expected nullable VARCHAR(50) definition.');
    }
    console.log('Business profile phone column verified. No profile values or setup progress were changed.');
  }
} finally {
  await connection.end();
}
