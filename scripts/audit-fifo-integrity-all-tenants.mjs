import 'dotenv/config';
import mysql from 'mysql2/promise';

import { auditFifoTenant } from './lib/fifo-integrity-audit.mjs';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectTimeout: 20_000,
});

let hasMismatch = false;
try {
  const mainDatabase = process.env.MYSQL_DATABASE;
  if (!mainDatabase) throw new Error('MYSQL_DATABASE is required to discover registered tenant schemas.');
  if (!/^[A-Za-z0-9_]+$/.test(mainDatabase)) throw new Error('MYSQL_DATABASE is invalid.');

  const [businesses] = await connection.query(
    `SELECT business_id, ims_db_name
       FROM \`${mainDatabase}\`.businesses
      WHERE ims_db_name IS NOT NULL AND deleted_at IS NULL
      ORDER BY ims_db_name`,
  );
  const requestedSchema = process.argv.find(argument => argument.startsWith('--schema='))?.slice('--schema='.length);
  const selected = requestedSchema
    ? businesses.filter(row => row.ims_db_name === requestedSchema)
    : businesses;
  if (requestedSchema && selected.length === 0) throw new Error('Requested schema is not registered.');

  for (const business of selected) {
    const result = await auditFifoTenant(connection, {
      schema: String(business.ims_db_name),
      businessId: String(business.business_id),
    });
    console.log(JSON.stringify(result));
    hasMismatch ||= result.status !== 'balanced';
  }
} finally {
  await connection.end();
}

if (hasMismatch) process.exitCode = 1;
