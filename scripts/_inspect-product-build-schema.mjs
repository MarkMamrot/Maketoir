import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

const schemas = [
  'readyedu_MonsterthreadsIMS',
  'readyedu_SageIMS',
  'readyedu_SolvantisPtyLtd_1dNtvCAmSU8QIMS',
  'readyedu_MonsterthreadsSandboxIMS',
];

for (const schema of schemas) {
  const [columns] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND ((TABLE_NAME = 'ims_product_variants' AND COLUMN_NAME = 'variant_id')
          OR (TABLE_NAME LIKE 'ims_product_build_%'
            AND COLUMN_NAME IN ('output_variant_id', 'component_variant_id')))
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [schema],
  );
  const [tables] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE 'ims_product_build_%'
      ORDER BY TABLE_NAME`,
    [schema],
  );
  console.log(JSON.stringify({ schema, tables: tables.map(row => row.TABLE_NAME), columns }, null, 2));
}

await connection.end();