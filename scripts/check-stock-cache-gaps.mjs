import 'dotenv/config';
import mysql from 'mysql2/promise';

const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const codes = [
  'HB5196W26','HB1219W26','HB5194W26','islatop1-kids','islatop2-kids',
  'HB1050S25','HB1312S25','HB1055S25','SS25-3G','SS25-3A','SS25-6A','SS25-6E',
  'SRS-HEJ','SRS-SPA','SBT-SPA','SBT-BIL','LG334- FLORET','LBH-HEJ','SW-LG257-RAINBOW','HE-PB347- DAISY','7.34007E+12'
];

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

for (const code of codes) {
  const [rows] = await db.execute(
    `SELECT code, branch_id, SUM(available) AS available, SUM(incoming) AS incoming, COUNT(*) AS row_count
     FROM stock
     WHERE business_id = ? AND code = ?
     GROUP BY code, branch_id
     ORDER BY branch_id`,
    [businessId, code],
  );

  console.log(`\n${code}: ${rows.length} branch rows`);
  if (!rows.length) {
    console.log('  no rows in stock cache');
    continue;
  }
  for (const r of rows) {
    console.log(`  branch=${r.branch_id} available=${Number(r.available)} incoming=${Number(r.incoming)} rows=${r.row_count}`);
  }
}

await db.end();
