require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: 'readyedu_MonsterthreadsIMS',
  });
  const [progress] = await connection.query(
    `SELECT COUNT(*) AS reconciled,
            SUM(reconciliation_state = 'matched') AS matched,
            SUM(reconciliation_state = 'review_required') AS review_required,
            SUM(reconciliation_state = 'error') AS errors
       FROM gift_cards
      WHERE last_reconciled_at >= '2026-08-27 16:18:00'`,
  );
  const [cards] = await connection.query(
    `SELECT id, code, shopify_gc_id, balance, status,
            shopify_observed_balance, shopify_observed_status,
            reconciliation_state, reconciliation_reason, last_reconciled_at
       FROM gift_cards
      WHERE RIGHT(code, 4) IN (?, ?, ?)
      ORDER BY code`,
    ['7215', '4848', 'q3xl'],
  );
  console.log(JSON.stringify({ progress: progress[0], cards }, null, 2));
  await connection.end();
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
