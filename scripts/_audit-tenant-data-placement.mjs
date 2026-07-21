// Audit: which rows live in which IMS schema, per business stamp.
// Usage: node scripts/_audit-tenant-data-placement.mjs
import 'dotenv/config';
import mysql from 'mysql2/promise';

const SAGE = '15R-c4wt8u6RQ51DV44vmhlZQgcWMQCvJo9NTxWum-Pw';
const MT   = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';

const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: +(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

for (const db of ['readyedu_MonsterthreadsIMS', 'readyedu_SageIMS']) {
  console.log('\n=== ' + db + ' ===');
  const [tabs] = await c.query(
    'SELECT TABLE_NAME t FROM information_schema.tables WHERE table_schema = ?', [db]);
  for (const { t } of tabs.sort((a, b) => a.t.localeCompare(b.t))) {
    const [cols] = await c.query(
      "SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name='business_id'",
      [db, t]);
    if (!cols[0].n) continue;
    const [r] = await c.query(
      `SELECT COUNT(*) total, COALESCE(SUM(business_id = ?),0) sage, COALESCE(SUM(business_id = ?),0) mt FROM \`${db}\`.\`${t}\``,
      [SAGE, MT]);
    const { total, sage, mt } = r[0];
    if (Number(total) > 0) {
      const other = Number(total) - Number(sage) - Number(mt);
      console.log(t.padEnd(40), `total=${total}`.padEnd(14), `sage=${sage}`.padEnd(12), `mt=${mt}`.padEnd(12), other ? `other/blank=${other}` : '');
    }
  }
}
await c.end();
