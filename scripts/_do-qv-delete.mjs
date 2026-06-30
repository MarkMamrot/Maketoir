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

// Delete sale items, payments, then the sale
const [items] = await conn.execute('DELETE FROM pos_sale_items WHERE sale_id = ?', [573242]);
console.log(`Deleted ${items.affectedRows} sale item(s) for sale 573242`);

const [pmts] = await conn.execute('DELETE FROM pos_payments WHERE sale_id = ?', [573242]);
console.log(`Deleted ${pmts.affectedRows} payment(s) for sale 573242`);

const [sale] = await conn.execute('DELETE FROM pos_sales WHERE id = ?', [573242]);
console.log(`Deleted ${sale.affectedRows} sale (id=573242)`);

// Delete the open register session
const [reg] = await conn.execute('DELETE FROM pos_register_sessions WHERE id = ?', [24]);
console.log(`Deleted ${reg.affectedRows} register session (id=24)`);

await conn.end();
console.log('\n✅ Done.');
