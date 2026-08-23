import 'dotenv/config';
import mysql from 'mysql2/promise';

const discoveryCopy = 'Available on demand. Fit, scope, timing, and price are confirmed after discovery and quote.';

const offerings = [
  ['xero', 'Xero', 'accounting_erp', 'native', 'Native accounting workflows for sales, payments, and reconciliation.', ['Xero']],
  ['shopify', 'Shopify', 'ecommerce_marketplaces', 'native', 'Native ecommerce, product, order, inventory, and customer workflows.', ['Shopify']],
  ['cin7', 'Cin7', 'accounting_erp', 'native', 'Native inventory, product, purchasing, and stock synchronisation.', ['Cin7 Core']],
  ['meta', 'Meta', 'crm_marketing', 'native', 'Native marketing performance visibility for Meta advertising.', ['Meta Ads']],
  ['google', 'Google', 'bi_warehouse', 'native', 'Native marketing and analytics visibility for Google services.', ['Google Ads', 'Google Analytics']],
  ['on-demand-3pl-wms-fulfilment', '3PL and WMS fulfilment', '3pl_wms_fulfilment', 'on_demand', discoveryCopy, ['3PL providers', 'warehouse management systems']],
  ['on-demand-ecommerce-marketplaces', 'Ecommerce and marketplaces', 'ecommerce_marketplaces', 'on_demand', discoveryCopy, ['marketplaces', 'commerce platforms']],
  ['on-demand-accounting-erp', 'Accounting and ERP', 'accounting_erp', 'on_demand', discoveryCopy, ['accounting platforms', 'ERP platforms']],
  ['on-demand-payments', 'Payments', 'payments', 'on_demand', discoveryCopy, ['payment gateways', 'payment processors']],
  ['on-demand-shipping-carriers', 'Shipping and carriers', 'shipping_carriers', 'on_demand', discoveryCopy, ['shipping aggregators', 'carriers']],
  ['on-demand-supplier-edi', 'Supplier and EDI', 'supplier_edi', 'on_demand', discoveryCopy, ['suppliers', 'EDI networks']],
  ['on-demand-crm-marketing', 'CRM and marketing', 'crm_marketing', 'on_demand', discoveryCopy, ['CRM platforms', 'marketing platforms']],
  ['on-demand-loyalty-gift-cards', 'Loyalty and gift cards', 'loyalty_gift_cards', 'on_demand', discoveryCopy, ['loyalty platforms', 'gift card platforms']],
  ['on-demand-bi-warehouse', 'BI and data warehouse', 'bi_warehouse', 'on_demand', discoveryCopy, ['BI platforms', 'data warehouses']],
  ['on-demand-identity-customer-service', 'Identity and customer service', 'identity_customer_service', 'on_demand', discoveryCopy, ['identity providers', 'customer service platforms']],
  ['on-demand-custom-exchange', 'Custom API, webhook, and file exchange', 'custom_api_webhook_file', 'on_demand', discoveryCopy, ['REST APIs', 'webhooks', 'CSV and flat files']],
];

const statements = [
  `CREATE TABLE IF NOT EXISTS sales_integration_offerings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, slug VARCHAR(100) NOT NULL, name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL, delivery_mode ENUM('native','on_demand','beta','not_offered') NOT NULL,
    public_summary TEXT NOT NULL, example_providers_json JSON NOT NULL, supported_workflows_json JSON NOT NULL,
    qualification_questions_json JSON NOT NULL, is_enabled TINYINT(1) NOT NULL DEFAULT 1, internal_notes TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_sales_integration_offering_slug (slug),
    INDEX idx_sales_integration_offering_public (is_enabled, delivery_mode, category, name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS prospect_conversations (
    id CHAR(36) PRIMARY KEY, session_id_hash CHAR(64) NOT NULL,
    status ENUM('active','converted','abandoned','closed','blocked') NOT NULL DEFAULT 'active', source_path VARCHAR(500) NULL,
    attribution_json JSON NULL, last_user_prompt LONGTEXT NULL, message_count INT UNSIGNED NOT NULL DEFAULT 0,
    last_message_at DATETIME(3) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_prospect_conversation_session (session_id_hash, updated_at), INDEX idx_prospect_conversation_status (status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS prospect_messages (
    id CHAR(36) PRIMARY KEY, conversation_id CHAR(36) NOT NULL, role ENUM('user','assistant') NOT NULL, content LONGTEXT NOT NULL,
    model_name VARCHAR(100) NULL, prompt_version VARCHAR(100) NULL, metadata_json JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX idx_prospect_message_conversation (conversation_id, created_at, id),
    CONSTRAINT fk_prospect_message_conversation FOREIGN KEY (conversation_id) REFERENCES prospect_conversations(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS sales_integration_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, idempotency_key VARCHAR(191) NOT NULL, offering_id BIGINT UNSIGNED NULL,
    conversation_id CHAR(36) NULL, event_type VARCHAR(64) NOT NULL, provider_name VARCHAR(191) NULL, event_data_json JSON NULL,
    occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY uq_sales_integration_event_idempotency (idempotency_key),
    INDEX idx_sales_integration_event_offering (offering_id, occurred_at), INDEX idx_sales_integration_event_conversation (conversation_id, occurred_at),
    CONSTRAINT fk_sales_integration_event_offering FOREIGN KEY (offering_id) REFERENCES sales_integration_offerings(id) ON DELETE SET NULL,
    CONSTRAINT fk_sales_integration_event_conversation FOREIGN KEY (conversation_id) REFERENCES prospect_conversations(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS prospect_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, idempotency_key VARCHAR(191) NOT NULL, conversation_id CHAR(36) NULL,
    event_type VARCHAR(64) NOT NULL, event_data_json JSON NULL, occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_prospect_event_idempotency (idempotency_key), INDEX idx_prospect_event_conversation (conversation_id, occurred_at),
    INDEX idx_prospect_event_type (event_type, occurred_at),
    CONSTRAINT fk_prospect_event_conversation FOREIGN KEY (conversation_id) REFERENCES prospect_conversations(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS prospect_leads (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, idempotency_key VARCHAR(191) NOT NULL, conversation_id CHAR(36) NULL,
    name VARCHAR(255) NOT NULL, company VARCHAR(255) NULL, email VARCHAR(320) NULL, phone VARCHAR(32) NULL,
    preferred_contact ENUM('email','phone','sms') NOT NULL, consent_email TINYINT(1) NOT NULL DEFAULT 0,
    consent_phone TINYINT(1) NOT NULL DEFAULT 0, consent_sms TINYINT(1) NOT NULL DEFAULT 0, consented_at DATETIME(3) NOT NULL,
    locations VARCHAR(100) NULL, current_systems TEXT NULL, timeframe VARCHAR(100) NULL, source_path VARCHAR(500) NULL,
    status ENUM('new','contacting','qualified','demo_booked','won','lost','spam') NOT NULL DEFAULT 'new',
    assigned_to INT NULL, notes TEXT NULL, loss_reason TEXT NULL,
    first_contacted_at DATETIME(3) NULL, followed_up_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_prospect_lead_idempotency (idempotency_key), UNIQUE KEY uq_prospect_lead_conversation (conversation_id),
    INDEX idx_prospect_lead_status (status, created_at), INDEX idx_prospect_lead_assignee (assigned_to, status, created_at),
    CONSTRAINT fk_prospect_lead_conversation FOREIGN KEY (conversation_id) REFERENCES prospect_conversations(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS prospect_lead_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, idempotency_key VARCHAR(191) NOT NULL, lead_id BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(64) NOT NULL, event_data_json JSON NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_prospect_lead_event_idempotency (idempotency_key), INDEX idx_prospect_lead_event_lead (lead_id, created_at),
    CONSTRAINT fk_prospect_lead_event_lead FOREIGN KEY (lead_id) REFERENCES prospect_leads(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS prospect_demand_insights (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, fingerprint CHAR(64) NOT NULL,
    demand_type ENUM('integration','feature','workflow','industry') NOT NULL, requested_name VARCHAR(255) NOT NULL,
    requested_provider VARCHAR(255) NULL, sample_prompt TEXT NULL, first_seen_at DATETIME(3) NOT NULL, last_seen_at DATETIME(3) NOT NULL,
    occurrence_count INT UNSIGNED NOT NULL DEFAULT 1, conversation_count INT UNSIGNED NOT NULL DEFAULT 1,
    UNIQUE KEY uq_prospect_demand_insight_fingerprint (fingerprint), INDEX idx_prospect_demand_insight_recent (demand_type, last_seen_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS prospect_rate_limits (
    rate_key_hash CHAR(64) NOT NULL, operation VARCHAR(64) NOT NULL, window_started_at DATETIME(3) NOT NULL,
    request_count INT UNSIGNED NOT NULL DEFAULT 1, expires_at DATETIME(3) NOT NULL,
    PRIMARY KEY (rate_key_hash, operation, window_started_at), INDEX idx_prospect_rate_limit_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  timezone: 'Z',
  charset: 'utf8mb4',
});

const expectedTables = [
  'sales_integration_offerings', 'sales_integration_events', 'prospect_conversations', 'prospect_messages',
  'prospect_events', 'prospect_leads', 'prospect_lead_events', 'prospect_demand_insights', 'prospect_rate_limits',
];

try {
  for (const statement of statements) await connection.execute(statement);
  const ensureColumn = async (table, column, definition) => {
    const [rows] = await connection.execute(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [table, column],
    );
    if (!rows.length) await connection.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  };
  const [statusRows] = await connection.execute(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prospect_conversations' AND COLUMN_NAME = 'status' LIMIT 1`,
  );
  if (statusRows[0] && !String(statusRows[0].COLUMN_TYPE).includes("'abandoned'")) {
    await connection.execute(
      `ALTER TABLE prospect_conversations
       MODIFY COLUMN status ENUM('active','converted','abandoned','closed','blocked') NOT NULL DEFAULT 'active'`,
    );
  }
  await ensureColumn('prospect_leads', 'assigned_to', 'INT NULL');
  await ensureColumn('prospect_leads', 'notes', 'TEXT NULL');
  await ensureColumn('prospect_leads', 'loss_reason', 'TEXT NULL');
  await ensureColumn('prospect_leads', 'first_contacted_at', 'DATETIME(3) NULL');
  await ensureColumn('prospect_leads', 'followed_up_at', 'DATETIME(3) NULL');
  for (const [slug, name, category, deliveryMode, publicSummary, providers] of offerings) {
    await connection.execute(
      `INSERT INTO sales_integration_offerings
        (slug, name, category, delivery_mode, public_summary, example_providers_json, supported_workflows_json, qualification_questions_json)
       VALUES (?, ?, ?, ?, ?, ?, JSON_ARRAY(), JSON_ARRAY())
       ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), delivery_mode = VALUES(delivery_mode),
         public_summary = VALUES(public_summary), example_providers_json = VALUES(example_providers_json)`,
      [slug, name, category, deliveryMode, publicSummary, JSON.stringify(providers)],
    );
  }

  const [tableRows] = await connection.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${expectedTables.map(() => '?').join(',')})`,
    expectedTables,
  );
  const foundTables = new Set(tableRows.map(row => row.TABLE_NAME));
  const missingTables = expectedTables.filter(table => !foundTables.has(table));
  if (missingTables.length) throw new Error(`Prospect sales assistant schema is missing tables: ${missingTables.join(', ')}`);

  const expectedColumns = [
    ['sales_integration_offerings', 'delivery_mode'], ['sales_integration_offerings', 'internal_notes'],
    ['prospect_conversations', 'session_id_hash'], ['prospect_conversations', 'last_user_prompt'],
    ['prospect_messages', 'content'], ['prospect_events', 'idempotency_key'],
    ['prospect_leads', 'preferred_contact'], ['prospect_leads', 'consented_at'], ['prospect_leads', 'assigned_to'],
    ['prospect_leads', 'notes'], ['prospect_leads', 'loss_reason'], ['prospect_leads', 'first_contacted_at'],
    ['prospect_leads', 'followed_up_at'],
    ['prospect_lead_events', 'idempotency_key'], ['prospect_demand_insights', 'fingerprint'],
    ['prospect_rate_limits', 'rate_key_hash'],
  ];
  const [columnRows] = await connection.execute(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${expectedTables.map(() => '?').join(',')})`,
    expectedTables,
  );
  const foundColumns = new Set(columnRows.map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  const missingColumns = expectedColumns.filter(([table, column]) => !foundColumns.has(`${table}.${column}`));
  if (missingColumns.length) throw new Error(`Prospect sales assistant schema is missing columns: ${missingColumns.map(value => value.join('.')).join(', ')}`);

  const [seedRows] = await connection.execute(
    `SELECT slug FROM sales_integration_offerings WHERE slug IN (${offerings.map(() => '?').join(',')})`,
    offerings.map(([slug]) => slug),
  );
  const foundSeeds = new Set(seedRows.map(row => row.slug));
  const missingSeeds = offerings.map(([slug]) => slug).filter(slug => !foundSeeds.has(slug));
  if (missingSeeds.length) throw new Error(`Prospect sales assistant schema is missing offerings: ${missingSeeds.join(', ')}`);

  console.log(`Prospect sales assistant tables and ${offerings.length} offerings are ready in ${process.env.MYSQL_DATABASE}.`);
} finally {
  await connection.end();
}