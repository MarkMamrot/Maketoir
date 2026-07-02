import 'dotenv/config';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const email = 'kaew@monsterthreads.com.au';
const newPassword = 'password';

const hash = await bcrypt.hash(newPassword, 12);
const [result] = await conn.execute(
  'UPDATE users SET password_hash = ? WHERE email = ? AND deleted_at IS NULL',
  [hash, email.toLowerCase()],
);
console.log(`Affected rows: ${result.affectedRows}`);
if (result.affectedRows === 0) {
  console.log('No user found — account may not exist in the users table.');
} else {
  console.log('Password updated successfully.');
}
await conn.end();
