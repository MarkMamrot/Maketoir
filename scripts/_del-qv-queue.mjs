import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]/,'').replace(/['"]$/,'')]; })
);

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST, port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.IMS_MYSQL_DATABASE,
});

// Find queue table
const [tables] = await conn.execute('SHOW TABLES LIKE "%queue%"');
console.log('Queue tables:', tables.map(r => Object.values(r)[0]));

// Find QV Shop location id
const [locs] = await conn.execute('SELECT id, name FROM ims_locations WHERE name LIKE "%QV Shop%"');
console.log('QV Shop location(s):', locs.map(l => `id=${l.id} "${l.name}"`).join(', '));

const locId = locs[0]?.id;

if (tables.length && locId) {
  const tbl = Object.values(tables[0])[0];
  const [rows] = await conn.execute(`SELECT * FROM ${tbl} WHERE location_id = ? LIMIT 10`, [locId]);
  console.log(`\nRows in ${tbl} for QV Shop (location_id=${locId}):`);
  for (const r of rows) console.log(' ', JSON.stringify(r));
}

await conn.end();
