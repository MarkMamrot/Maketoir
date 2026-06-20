import mysql from 'mysql2/promise';
import 'dotenv/config';

const c = await mysql.createConnection({
  host: process.env.NEW_MYSQL_HOST,
  port: +process.env.NEW_MYSQL_PORT,
  user: process.env.NEW_MYSQL_USER,
  password: process.env.NEW_MYSQL_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

const [sizes] = await c.query(`
  SELECT table_schema,
         ROUND(SUM(data_length + index_length) / 1024 / 1024, 1) AS mb
  FROM   information_schema.tables
  GROUP  BY table_schema
  ORDER  BY mb DESC
`);
console.log('\n=== Database sizes (MB) ===');
console.table(sizes);

const [vars] = await c.query("SHOW VARIABLES LIKE 'innodb_%file%'");
console.log('\n=== InnoDB file vars ===');
console.table(vars);

const [status] = await c.query("SHOW GLOBAL STATUS LIKE 'Innodb_data%'");
console.log('\n=== InnoDB data status ===');
console.table(status);

await c.end();
