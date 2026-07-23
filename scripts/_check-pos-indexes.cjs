const mysql = require('mysql2/promise');
require('dotenv').config();

// Check indexes on ims_product_images
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
  });
  const db = 'readyedu_MonsterthreadsIMS';
  const [indexes] = await conn.query(`SHOW INDEX FROM \`${db}\`.ims_product_images`);
  console.log('Indexes on ims_product_images:');
  indexes.forEach(i => console.log(' ', i.Key_name, '-', i.Column_name));

  const [stockIdx] = await conn.query(`SHOW INDEX FROM \`${db}\`.ims_stock`);
  console.log('\nIndexes on ims_stock:');
  stockIdx.forEach(i => console.log(' ', i.Key_name, '-', i.Column_name));

  await conn.end();
})().catch(e => { console.error(e.message); process.exit(1); });
