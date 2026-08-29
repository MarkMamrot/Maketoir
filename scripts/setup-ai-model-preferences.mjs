/**
 * Adds per-function AI model preferences to tenant connections.
 * Run: node scripts/setup-ai-model-preferences.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const columns = [
  ['ai_document_extraction_model', 'VARCHAR(100) NULL AFTER gemini_model'],
  ['ai_catalogue_matching_model', 'VARCHAR(100) NULL AFTER ai_document_extraction_model'],
  ['ai_business_intelligence_model', 'VARCHAR(100) NULL AFTER ai_catalogue_matching_model'],
  ['ai_customer_service_model', 'VARCHAR(100) NULL AFTER ai_business_intelligence_model'],
];

try {
  for (const [columnName, definition] of columns) {
    const [existing] = await connection.query(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'connections' AND COLUMN_NAME = ? LIMIT 1`,
      [columnName],
    );
    if (existing.length === 0) {
      await connection.query(`ALTER TABLE connections ADD COLUMN ${columnName} ${definition}`);
      console.log(`Added connections.${columnName}`);
    } else {
      console.log(`Already present: connections.${columnName}`);
    }
  }

  const [seedResult] = await connection.query(
    `UPDATE connections
        SET ai_document_extraction_model = COALESCE(ai_document_extraction_model, 'gemini-2.5-pro'),
            ai_catalogue_matching_model = COALESCE(ai_catalogue_matching_model, 'gemini-2.5-flash')
      WHERE ai_document_extraction_model IS NULL OR ai_catalogue_matching_model IS NULL`,
  );
  console.log(`Seeded recommended document models for ${seedResult.affectedRows} connection row(s).`);

  const [verified] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'connections'
        AND COLUMN_NAME IN (${columns.map(() => '?').join(', ')})`,
    columns.map(([columnName]) => columnName),
  );
  if (verified.length !== columns.length) throw new Error('AI model preference column verification failed.');
  console.log('AI model preference schema ready.');
} finally {
  await connection.end();
}