import mysql from "mysql2/promise";
import "dotenv/config";
const c = await mysql.createConnection({
  host: process.env.NEW_MYSQL_HOST, port: +process.env.NEW_MYSQL_PORT,
  user: process.env.NEW_MYSQL_USER, password: process.env.NEW_MYSQL_PASSWORD,
  ssl: { rejectUnauthorized: false }
});
const [[r]] = await c.query("SELECT VERSION() AS v");
console.log("Connected! MySQL", r.v);
const [dbs] = await c.query("SHOW DATABASES");
console.log("Databases:", dbs.map(d => d.Database).join(", "));
await c.end();
