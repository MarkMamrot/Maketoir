const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: 'thomas.proxy.rlwy.net',
    port: 15319,
    user: 'root',
    password: 'wzRIeQOychDJMpfnXsyEOHPyHmFEkZcH',
  });

  const [tableMatches] = await conn.query(
    `SELECT table_schema, table_name FROM information_schema.tables WHERE table_name = 'xero_gateway_mappings' OR table_name LIKE '%zip%' ORDER BY table_schema, table_name`
  );
  console.log('TABLE_MATCHES', JSON.stringify(tableMatches, null, 2));

  const [xeroGatewayRows] = await conn.query(
    `SELECT * FROM readyedu_Solvantis.xero_gateway_mappings WHERE LOWER(gateway_name) LIKE '%zip%' OR LOWER(display_name) LIKE '%zip%' ORDER BY gateway_name LIMIT 50`
  );
  console.log('SOLVANTIS_ZIP_ROWS', JSON.stringify(xeroGatewayRows, null, 2));

  const [allGatewayRows] = await conn.query(
    `SELECT table_schema, table_name FROM information_schema.columns WHERE column_name IN ('gateway_name','display_name','fixed_fee_amount','percentage_fee_rate','fee_account_code','deduct_fee_enabled') ORDER BY table_schema, table_name LIMIT 200`
  );
  console.log('ALL_GATEWAY_FIELDS', JSON.stringify(allGatewayRows, null, 2));

  await conn.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
