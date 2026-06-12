import 'dotenv/config';
import mysql from 'mysql2/promise';

// Check marketoir DB for cin7 cache tables, and inspect a sample PO line item
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: 'readyedu_marketoir',
});

const [tables] = await pool.query('SHOW TABLES');
const allNames = tables.map(r => Object.values(r)[0]);
console.log('All tables:', allNames);

// Try to query cin7_purchase_orders or similar
for (const t of allNames) {
  if (String(t).toLowerCase().includes('purchase') || String(t).toLowerCase().includes('po')) {
    console.log('\nTable:', t);
    const [rows] = await pool.query(`SELECT * FROM \`${t}\` LIMIT 1`);
    if (rows.length) console.log('Sample row keys:', Object.keys(rows[0]));
    const [sample] = await pool.query(`SELECT * FROM \`${t}\` LIMIT 1`);
    if (sample.length) {
      // Show keys with non-null values
      const row = sample[0];
      const nonNull = Object.fromEntries(Object.entries(row).filter(([,v]) => v != null && v !== '' && v !== 0));
      console.log('Non-null fields:', JSON.stringify(nonNull, null, 2));
    }
  }
}

await pool.end();
