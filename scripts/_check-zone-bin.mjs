import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

const [stockCols] = await conn.execute('SHOW COLUMNS FROM ims_stock');
console.log('ims_stock columns:', stockCols.map(c => c.Field).join(', '));

const [prodCols] = await conn.execute('SHOW COLUMNS FROM ims_products');
console.log('ims_products columns:', prodCols.map(c => c.Field).join(', '));

const [[zb]] = await conn.execute(
  `SELECT SUM(zone IS NOT NULL AND zone != '') as has_zone,
          SUM(bin  IS NOT NULL AND bin  != '') as has_bin,
          COUNT(*) as total FROM ims_products`
);
console.log(`Products with zone: ${zb.has_zone} | with bin: ${zb.has_bin} | total: ${zb.total}`);

const [samples] = await conn.execute(
  `SELECT name, zone, bin FROM ims_products WHERE zone IS NOT NULL AND zone != '' LIMIT 5`
);
console.log('Sample products with zone:');
console.table(samples);

await conn.end();
