import dotenv from 'dotenv'; dotenv.config();
import mysql from 'mysql2/promise';

async function auditDb(config, label) {
  const c = await mysql.createConnection({ ...config, ssl: { rejectUnauthorized: false } });
  const [tables] = await c.query('SHOW TABLES');
  const tableNames = tables.map(t => Object.values(t)[0]);
  console.log(`\n=== ${label} ===`);
  for (const t of tableNames) {
    const [cols] = await c.query(`SHOW COLUMNS FROM \`${t}\``);
    const hasBizId = cols.some(col => col.Field === 'business_id');
    const [countRes] = await c.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    const n = countRes[0].n;
    if (hasBizId) {
      const [nullRes] = await c.query(`SELECT COUNT(*) AS n FROM \`${t}\` WHERE business_id IS NULL OR business_id = ''`);
      console.log(`[HAS]  ${String(t).padEnd(45)} rows=${n}, null_biz=${nullRes[0].n}`);
    } else {
      console.log(`[MISS] ${String(t).padEnd(45)} rows=${n}`);
    }
  }
  await c.end();
}

const base = { host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD };
await auditDb({ ...base, database: process.env.MYSQL_DATABASE }, 'Main DB: ' + process.env.MYSQL_DATABASE);
await auditDb({ ...base, database: process.env.IMS_MYSQL_DATABASE }, 'IMS DB: ' + process.env.IMS_MYSQL_DATABASE);
