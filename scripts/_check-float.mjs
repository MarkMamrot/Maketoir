import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]/,'').replace(/['"]$/,'')]; })
);

// Check main DB (config table)
const c = await mysql.createConnection({
  host: env.MYSQL_HOST, port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.MYSQL_DATABASE,
});
const [rows] = await c.execute("SELECT business_id, `key`, value FROM config WHERE `key` = 'POS_DefaultFloat'");
console.log('config table rows:', JSON.stringify(rows));
await c.end();
