const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: 'thomas.proxy.rlwy.net',
    port: 15319,
    user: 'root',
    password: 'wzRIeQOychDJMpfnXsyEOHPyHmFEkZcH',
  });

  const [rows] = await conn.query(
    `SELECT business_id, gateway_name, display_name, fee_account_code, fee_tax_type, deduct_fee_enabled, fixed_fee_amount, percentage_fee_rate
     FROM readyedu_Solvantis.xero_gateway_mappings
     WHERE gateway_name = 'zip' OR display_name = 'Zip'
     ORDER BY updated_at DESC
     LIMIT 10`
  );

  console.log(JSON.stringify(rows, null, 2));
  await conn.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
