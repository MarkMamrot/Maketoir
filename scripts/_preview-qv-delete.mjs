import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']/, '').replace(/["']$/, '')]; })
);

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST, port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.IMS_MYSQL_DATABASE,
});

const [locs] = await conn.execute("SELECT id, name FROM ims_locations WHERE name LIKE '%QV%' OR name LIKE '%Qv%' OR name LIKE '%qv%'");
console.log('\nQV location(s):', locs.map(l => `id=${l.id} name="${l.name}"`).join(', '));

if (!locs.length) { console.log('No QV location found.'); await conn.end(); process.exit(0); }
const locId = locs[0].id;

const [sessions] = await conn.execute(
  "SELECT id, register_id, session_date, opened_at, status FROM pos_register_sessions WHERE location_id = ? AND status = 'open'",
  [locId]
);
console.log('\nOpen register sessions to delete:', sessions.map(s => `id=${s.id} register_id=${s.register_id} date=${s.session_date} opened=${s.opened_at}`).join('\n  '));

const today = new Date().toISOString().slice(0, 10);
const [sales] = await conn.execute(
  "SELECT id, created_at, total, status, cashier_name FROM pos_sales WHERE location_id = ? AND DATE(created_at) = ?",
  [locId, today]
);
console.log('\nToday\'s sales to delete:', sales.map(s => `id=${s.id} total=$${s.total} status=${s.status} by=${s.cashier_name} at=${s.created_at}`).join('\n  '));

await conn.end();
