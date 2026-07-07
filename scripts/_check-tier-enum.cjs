require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: +(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  });
  const [r] = await c.execute("SHOW COLUMNS FROM users WHERE Field='tier'");
  console.log('Current tier ENUM:', r[0]?.Type);
  await c.end();
})().catch(e => console.error(e.message));
