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
    `SELECT business_id, name, ims_db_name, automation_paused
       FROM businesses
      WHERE name = 'Monsterthreads' AND deleted_at IS NULL LIMIT 1`,
  );
  const business = businesses[0];
  if (!business || !/^[A-Za-z0-9_]+$/.test(business.ims_db_name)) {
    throw new Error('Monsterthreads tenant schema was not found.');
  }
  const schema = business.ims_db_name;
  const [instances] = await connection.execute(
    `SELECT channel_instance_id, provider, display_name, is_enabled, runtime_status,
            readiness_status, settings_json, last_sync_at, safe_error
       FROM sales_channel_instances
      WHERE BINARY business_id = BINARY ? AND provider = 'shopify'`,
    [business.business_id],
  );
  const [queue] = await connection.query(
    `SELECT COUNT(*) AS queued, MIN(queued_at) AS oldest_queued_at, MAX(queued_at) AS newest_queued_at
       FROM \`${schema}\`.ims_shopify_inventory_queue`,
  );
  const [queueCoverage] = await connection.execute(
    `SELECT COUNT(*) AS queued,
            SUM(CASE WHEN mapping.id IS NOT NULL THEN 1 ELSE 0 END) AS exact_mapped,
            SUM(CASE WHEN mapping.id IS NULL THEN 1 ELSE 0 END) AS unmapped
       FROM \`${schema}\`.ims_shopify_inventory_queue queue_item
       LEFT JOIN \`${schema}\`.ims_product_variants variant
         ON BINARY variant.variant_id = BINARY queue_item.variant_id
       LEFT JOIN \`${schema}\`.ims_products product
         ON BINARY product.product_id = BINARY variant.product_id
       LEFT JOIN \`${schema}\`.ims_sales_channel_product_mappings mapping
         ON BINARY mapping.business_id = BINARY product.business_id
        AND BINARY mapping.variant_id = BINARY variant.variant_id
        AND mapping.channel_instance_id = ?
        AND mapping.mapping_status = 'linked'
        AND mapping.external_inventory_id IS NOT NULL
        AND mapping.external_inventory_id <> ''`,
    [instances[0]?.channel_instance_id ?? ''],
  );
  const [jobSummary] = await connection.execute(
    `SELECT status, COUNT(*) AS count, MIN(created_at) AS oldest, MAX(updated_at) AS newest
       FROM \`${schema}\`.ims_sales_channel_jobs
      WHERE BINARY business_id = BINARY ? AND provider = 'shopify' AND operation = 'shopify_inventory'
      GROUP BY status ORDER BY status`,
    [business.business_id],
  );
  const [recentJobs] = await connection.execute(
    `SELECT id, channel_instance_id, status, attempts, safe_error, created_at, updated_at, completed_at,
            JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.variantId')) AS variant_id
       FROM \`${schema}\`.ims_sales_channel_jobs
      WHERE BINARY business_id = BINARY ? AND provider = 'shopify' AND operation = 'shopify_inventory'
      ORDER BY updated_at DESC LIMIT 20`,
    [business.business_id],
  );
  const [recentLogs] = await connection.execute(
    `SELECT channel_instance_id, status, summary, created_at
       FROM \`${schema}\`.ims_shopify_sync_log
      WHERE BINARY business_id = BINARY ? AND action = 'upload'
        AND summary LIKE 'Inventory sync pushed%'
      ORDER BY created_at DESC LIMIT 20`,
    [business.business_id],
  );
  const [mappingCounts] = await connection.execute(
    `SELECT channel_instance_id, COUNT(*) AS linked_inventory_variants,
            MAX(last_seen_at) AS latest_mapping_seen_at
       FROM \`${schema}\`.ims_sales_channel_product_mappings
      WHERE BINARY business_id = BINARY ? AND mapping_status = 'linked'
        AND external_inventory_id IS NOT NULL AND external_inventory_id <> ''
      GROUP BY channel_instance_id`,
    [business.business_id],
  );
  const [runtimeIssues] = await connection.execute(
    `SELECT status, operation, message, occurrence_count, first_seen_at, last_seen_at, latest_context
       FROM runtime_issues
      WHERE BINARY business_id = BINARY ? AND source = 'shopify_inventory'
      ORDER BY last_seen_at DESC LIMIT 20`,
    [business.business_id],
  );
  const [collations] = await connection.execute(
    `SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND COLUMN_NAME IN ('business_id', 'product_id', 'variant_id')
        AND TABLE_NAME IN ('ims_products', 'ims_product_variants', 'ims_shopify_inventory_queue',
                           'ims_sales_channel_product_mappings')
      ORDER BY TABLE_NAME, COLUMN_NAME`,
    [schema],
  );
  const [processes] = await connection.query(
    `SELECT ID, TIME, STATE, LEFT(INFO, 500) AS INFO
       FROM information_schema.PROCESSLIST
      WHERE DB = ? AND COMMAND <> 'Sleep' ORDER BY TIME DESC`,
    [schema],
  );
  const [fanOutPlan] = await connection.execute(
    `EXPLAIN SELECT mapping.business_id, mapping.channel_instance_id, mapping.variant_id
       FROM \`${schema}\`.ims_shopify_inventory_queue queue_item
       JOIN \`${schema}\`.ims_product_variants variant
         ON BINARY variant.variant_id = BINARY queue_item.variant_id
       JOIN \`${schema}\`.ims_products product
         ON BINARY product.product_id = BINARY variant.product_id
       JOIN \`${schema}\`.ims_sales_channel_product_mappings mapping
         ON BINARY mapping.business_id = BINARY product.business_id
        AND BINARY mapping.variant_id = BINARY variant.variant_id
      WHERE product.business_id = ? AND mapping.channel_instance_id = ?
        AND mapping.mapping_status = 'linked'
        AND mapping.external_inventory_id IS NOT NULL AND mapping.external_inventory_id <> ''`,
    [business.business_id, instances[0]?.channel_instance_id ?? ''],
  );
  console.log(JSON.stringify({
    business: { ...business, business_id: '[redacted]' },
    instances,
    queue: queue[0],
    queueCoverage: queueCoverage[0],
    jobSummary,
    recentJobs,
    recentLogs,
    mappingCounts,
    runtimeIssues,
    collations,
    processes,
    fanOutPlan,
  }, null, 2));
} finally {
  await connection.end();
}