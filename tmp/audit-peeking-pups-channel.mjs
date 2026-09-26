import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
try {
  const [businesses] = await connection.execute(
    `SELECT business_id, name, ims_db_name FROM businesses WHERE name = 'Monsterthreads' AND deleted_at IS NULL LIMIT 1`,
  );
  const business = businesses[0];
  if (!business || !/^[A-Za-z0-9_]+$/.test(business.ims_db_name)) throw new Error('Monsterthreads schema unavailable.');
  const [instances] = await connection.execute(
    `SELECT channel_instance_id, display_name, is_enabled, runtime_status, readiness_status, settings_json
       FROM sales_channel_instances WHERE BINARY business_id = BINARY ? AND provider = 'shopify'`,
    [business.business_id],
  );
  const [products] = await connection.execute(
    `SELECT product_id, name, website_title, is_active, is_online, shopify_product_id
       FROM \`${business.ims_db_name}\`.ims_products
      WHERE name LIKE '%Peeking Pups Dachshund Mug%' OR website_title LIKE '%Peeking Pups Dachshund Mug%'`,
  );
  const detail = [];
  for (const product of products) {
    const [assignments] = await connection.execute(
      `SELECT channel_instance_id, override_mode, desired_state, provider_state, readiness_status,
              readiness_issues_json, external_product_id, last_submitted_at, last_observed_at, updated_at
         FROM \`${business.ims_db_name}\`.ims_sales_channel_product_assignments WHERE product_id = ?`,
      [product.product_id],
    );
    const [mappings] = await connection.execute(
      `SELECT mapping.channel_instance_id, mapping.variant_id, mapping.external_product_id,
              mapping.external_variant_id, mapping.mapping_status
         FROM \`${business.ims_db_name}\`.ims_sales_channel_product_mappings mapping
         JOIN \`${business.ims_db_name}\`.ims_product_variants variant
           ON BINARY variant.variant_id = BINARY mapping.variant_id
        WHERE variant.product_id = ?`,
      [product.product_id],
    );
    const [jobs] = await connection.execute(
      `SELECT channel_instance_id, operation, status, attempts, safe_error, created_at, completed_at
         FROM \`${business.ims_db_name}\`.ims_sales_channel_jobs
        WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.productId')) = ? ORDER BY id DESC`,
      [product.product_id],
    );
    detail.push({ product, assignments, mappings, jobs });
  }
  console.log(JSON.stringify({ instances, detail }, null, 2));
} finally {
  await connection.end();
}
