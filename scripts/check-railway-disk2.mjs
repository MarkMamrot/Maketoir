// Top-up: insert missing pos_users and pos_sales rows into Railway
import mysql from "mysql2/promise";
import "dotenv/config";

function escape(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  if (val instanceof Date) return "'" + val.toISOString().slice(0,19).replace("T"," ") + "'";
  if (Buffer.isBuffer(val)) return "X'" + val.toString("hex") + "'";
  const s = String(val).replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/\0/g,"\\0").replace(/\n/g,"\\n").replace(/\r/g,"\\r").replace(/\x1a/g,"\\Z");
  return "'" + s + "'";
}

const src = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +(process.env.MYSQL_PORT||3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});
const dst = await mysql.createConnection({
  host: process.env.NEW_MYSQL_HOST, port: +process.env.NEW_MYSQL_PORT,
  user: process.env.NEW_MYSQL_USER, password: process.env.NEW_MYSQL_PASSWORD,
  ssl: { rejectUnauthorized: false },
});
await dst.query("USE readyedu_MonsterthreadsIMS");
await dst.query("SET FOREIGN_KEY_CHECKS = 0");
await dst.query("SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'");

// pos_users (1 row - recreate cleanly)
console.log("\n-- pos_users --");
try {
  const [[cr]] = await src.query("SHOW CREATE TABLE `pos_users`");
  await dst.query("DROP TABLE IF EXISTS `pos_users`");
  await dst.query(cr["Create Table"].replace(/\s+/g," ").trim());
  const [rows] = await src.query("SELECT * FROM `pos_users`");
  const [cols] = await src.query("SHOW COLUMNS FROM `pos_users`");
  const cn = cols.map(c => "`"+c.Field+"`").join(", ");
  for (const row of rows) {
    await dst.query("INSERT INTO `pos_users` ("+cn+") VALUES ("+Object.values(row).map(escape).join(", ")+")");
  }
  console.log("  OK: " + rows.length + " row(s)");
} catch(e) { console.error("  FAIL:", e.message); }

// pos_sales: only rows beyond what is already in Railway
console.log("\n-- pos_sales (top-up) --");
const [[{ maxId }]] = await dst.query("SELECT COALESCE(MAX(id),0) AS maxId FROM `pos_sales`");
const [[{ total }]] = await src.query("SELECT COUNT(*) AS total FROM `pos_sales` WHERE id > " + maxId);
console.log("  Railway max id=" + maxId + ", inserting " + total + " remaining rows...");
const [cols] = await src.query("SHOW COLUMNS FROM `pos_sales`");
const cn = cols.map(c => "`"+c.Field+"`").join(", ");
let lastId = maxId, inserted = 0;
while (true) {
  const [rows] = await src.query("SELECT * FROM `pos_sales` WHERE id > " + lastId + " ORDER BY id LIMIT 500");
  if (rows.length === 0) break;
  const vals = rows.map(r => "("+Object.values(r).map(escape).join(", ")+")").join(",\n  ");
  await dst.query("INSERT INTO `pos_sales` ("+cn+") VALUES\n  "+vals);
  lastId = rows[rows.length-1].id;
  inserted += rows.length;
  process.stdout.write("\r  " + inserted + " / " + total);
}
console.log("\n  OK: " + inserted + " rows inserted");

await src.end();
await dst.end();
console.log("\nDone.");
