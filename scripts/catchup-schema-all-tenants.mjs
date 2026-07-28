/**
 * Catch-up migration: add all columns that exist in Monsterthreads but are
 * missing from other IMS tenant schemas.
 *
 * Safe to re-run — uses ADD COLUMN IF NOT EXISTS throughout.
 * Run: node scripts/catchup-schema-all-tenants.mjs
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host:           process.env.MYSQL_HOST,
  port:           parseInt(process.env.MYSQL_PORT || '3306'),
  user:           process.env.MYSQL_USER,
  password:       process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

const TABLE_DDLS = [
  `CREATE TABLE IF NOT EXISTS ims_cs_settings (
    business_id VARCHAR(100) NOT NULL PRIMARY KEY,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    timezone_override VARCHAR(100) NULL,
    run_times_json TEXT NOT NULL,
    automation_mode ENUM('draft','send') NOT NULL DEFAULT 'draft',
    lookback_days INT NOT NULL DEFAULT 7,
    retention_days INT NOT NULL DEFAULT 90,
    light_model_id VARCHAR(150) NOT NULL DEFAULT 'gemini-2.5-flash',
    capable_model_id VARCHAR(150) NOT NULL DEFAULT 'gemini-2.5-pro',
    enabled_tools_json TEXT NOT NULL,
    guidelines MEDIUMTEXT NULL,
    helper_emails_json TEXT NOT NULL,
    learning_enabled TINYINT(1) NOT NULL DEFAULT 1,
    gmail_history_id VARCHAR(100) NULL,
    last_run_at DATETIME NULL,
    next_run_at DATETIME NULL,
    last_error TEXT NULL,
    lock_owner VARCHAR(150) NULL,
    lock_claimed_at DATETIME NULL,
    legacy_imported_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_cs_threads (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    gmail_thread_id VARCHAR(255) NOT NULL,
    latest_message_id VARCHAR(255) NULL,
    customer_id INT NULL,
    customer_email VARCHAR(255) NULL,
    subject VARCHAR(500) NOT NULL DEFAULT '',
    snippet VARCHAR(1000) NULL,
    participants_json TEXT NOT NULL,
    gmail_labels_json TEXT NOT NULL,
    message_count INT NOT NULL DEFAULT 0,
    unread_count INT NOT NULL DEFAULT 0,
    category ENUM('customer_enquiry','junk','other') NULL,
    enquiry_subtype VARCHAR(50) NULL,
    classification_confidence DECIMAL(5,4) NULL,
    classification_reason VARCHAR(1000) NULL,
    urgency ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
    sentiment ENUM('negative','neutral','positive') NOT NULL DEFAULT 'neutral',
    workflow_status ENUM('open','needs_review','drafted','sent','archived','failed') NOT NULL DEFAULT 'open',
    assigned_user_id INT NULL,
    classifier_model_id VARCHAR(150) NULL,
    classifier_version VARCHAR(50) NULL,
    classified_at DATETIME NULL,
    last_message_at DATETIME NOT NULL,
    last_gmail_sync_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cs_thread_gmail (business_id, gmail_thread_id),
    INDEX idx_cs_thread_list (business_id, last_message_at),
    INDEX idx_cs_thread_category (business_id, category, workflow_status),
    INDEX idx_cs_thread_customer (business_id, customer_email),
    INDEX idx_cs_thread_unread (business_id, unread_count)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_cs_messages (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    thread_id BIGINT NOT NULL,
    gmail_message_id VARCHAR(255) NOT NULL,
    gmail_thread_id VARCHAR(255) NOT NULL,
    direction ENUM('inbound','outbound','draft') NOT NULL,
    from_address VARCHAR(500) NOT NULL DEFAULT '',
    to_json TEXT NOT NULL,
    cc_json TEXT NOT NULL,
    subject VARCHAR(500) NOT NULL DEFAULT '',
    message_id_header VARCHAR(1000) NULL,
    references_header TEXT NULL,
    body_plain MEDIUMTEXT NULL,
    body_html MEDIUMTEXT NULL,
    attachment_metadata_json MEDIUMTEXT NOT NULL,
    gmail_labels_json TEXT NOT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 1,
    is_draft TINYINT(1) NOT NULL DEFAULT 0,
    is_sent TINYINT(1) NOT NULL DEFAULT 0,
    message_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cs_message_gmail (business_id, gmail_message_id),
    INDEX idx_cs_message_thread (business_id, thread_id, message_at),
    INDEX idx_cs_message_date (business_id, message_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_cs_drafts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    thread_id BIGINT NOT NULL,
    target_message_id BIGINT NOT NULL,
    operation_key VARCHAR(191) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    status ENUM('generated','editing','gmail_draft','sending','sent','failed','superseded') NOT NULL DEFAULT 'generated',
    subject VARCHAR(500) NOT NULL DEFAULT '',
    ai_generated_body MEDIUMTEXT NOT NULL,
    current_body MEDIUMTEXT NOT NULL,
    gmail_draft_id VARCHAR(255) NULL,
    gmail_sent_message_id VARCHAR(255) NULL,
    model_id VARCHAR(150) NOT NULL,
    prompt_version VARCHAR(50) NOT NULL,
    confidence DECIMAL(5,4) NULL,
    needs_information TINYINT(1) NOT NULL DEFAULT 0,
    escalation_reason VARCHAR(1000) NULL,
    tool_provenance_json MEDIUMTEXT NOT NULL,
    editor_user_id INT NULL,
    edited_at DATETIME NULL,
    sent_at DATETIME NULL,
    last_error TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cs_draft_operation (business_id, operation_key),
    INDEX idx_cs_draft_thread (business_id, thread_id, status),
    INDEX idx_cs_draft_target (business_id, target_message_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_cs_draft_revisions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    draft_id BIGINT NOT NULL,
    version INT NOT NULL,
    body MEDIUMTEXT NOT NULL,
    change_source ENUM('ai','user','send') NOT NULL,
    user_id INT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cs_draft_revision (business_id, draft_id, version),
    INDEX idx_cs_revision_draft (business_id, draft_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_cs_processing_runs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    run_type ENUM('sync','classify','generate','send','cleanup','learn') NOT NULL,
    trigger_type ENUM('manual','schedule','system') NOT NULL,
    status ENUM('running','success','partial','error') NOT NULL,
    counts_json TEXT NOT NULL,
    error_message TEXT NULL,
    started_at DATETIME NOT NULL,
    completed_at DATETIME NULL,
    duration_ms INT NULL,
    INDEX idx_cs_run_business (business_id, started_at),
    INDEX idx_cs_run_status (business_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_cs_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    thread_id BIGINT NULL,
    draft_id BIGINT NULL,
    event_type VARCHAR(80) NOT NULL,
    actor_type ENUM('user','ai','gmail','system') NOT NULL,
    actor_id VARCHAR(150) NULL,
    details_json MEDIUMTEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cs_event_thread (business_id, thread_id, created_at),
    INDEX idx_cs_event_type (business_id, event_type, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_cs_learning_evidence (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    draft_id BIGINT NULL,
    evidence_type ENUM('draft_edit','rating','classification_correction','manual_finding','rejection') NOT NULL,
    sanitized_summary TEXT NOT NULL,
    evidence_hash CHAR(64) NOT NULL,
    is_factual TINYINT(1) NOT NULL DEFAULT 0,
    expires_at DATETIME NULL,
    processed_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cs_evidence_hash (business_id, evidence_hash),
    INDEX idx_cs_evidence_type (business_id, evidence_type, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_cs_learning_candidates (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    rule_key VARCHAR(191) NOT NULL,
    rule_type ENUM('style','fact','policy') NOT NULL,
    title VARCHAR(255) NOT NULL,
    proposed_markdown TEXT NOT NULL,
    status ENUM('pending','active','rejected','superseded') NOT NULL DEFAULT 'pending',
    evidence_count INT NOT NULL DEFAULT 1,
    confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
    auto_activated TINYINT(1) NOT NULL DEFAULT 0,
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cs_learning_rule (business_id, rule_key),
    INDEX idx_cs_learning_status (business_id, status, rule_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_cs_knowledge_documents (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    document_key ENUM('style','knowledge') NOT NULL,
    filename VARCHAR(100) NOT NULL,
    markdown_content MEDIUMTEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    content_hash CHAR(64) NOT NULL,
    updated_by INT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cs_document (business_id, document_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_cs_knowledge_versions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    document_key ENUM('style','knowledge') NOT NULL,
    version INT NOT NULL,
    markdown_content MEDIUMTEXT NOT NULL,
    content_hash CHAR(64) NOT NULL,
    change_reason VARCHAR(500) NULL,
    created_by INT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cs_document_version (business_id, document_key, version),
    INDEX idx_cs_document_history (business_id, document_key, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_credit_notes (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    business_id         VARCHAR(150) NOT NULL,
    cn_number           VARCHAR(30)  NOT NULL,
    customer_id         INT          NULL,
    so_id               INT          NULL,
    original_so_number  VARCHAR(100) NULL,
    location_id         INT          NOT NULL,
    status              ENUM('draft','awaiting_product','complete','cancelled') NOT NULL DEFAULT 'draft',
    source              ENUM('manual','shopify','pos') NOT NULL DEFAULT 'manual',
    pos_sale_id         INT          NULL,
    settlement_method   ENUM('store_credit','refund','external') NOT NULL DEFAULT 'store_credit',
    settlement_status   ENUM('pending','complete','error') NOT NULL DEFAULT 'pending',
    store_credit_transaction_id INT NULL,
    shopify_return_id   VARCHAR(100) NULL,
    cn_date             DATE         NOT NULL,
    completed_at        DATETIME     NULL,
    reference           VARCHAR(255) NULL,
    tax_treatment       ENUM('ex_tax','inc_tax') NOT NULL DEFAULT 'ex_tax',
    tax_code            VARCHAR(50)  NULL,
    subtotal            DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
    notes               TEXT         NULL,
    xero_credit_note_id VARCHAR(100) NULL,
    xero_synced_at      DATETIME     NULL,
    xero_sync_status    ENUM('synced','queued','error') NULL,
    created_by          VARCHAR(150) NULL,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_business (business_id),
    INDEX idx_status (status),
    INDEX idx_customer (customer_id),
    INDEX idx_shopify_return (business_id, shopify_return_id),
    UNIQUE INDEX uq_cn_pos_sale (business_id, pos_sale_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_credit_note_items (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    cn_id        INT           NOT NULL,
    variant_id   VARCHAR(100)  NULL,
    code         VARCHAR(100)  NULL,
    name         VARCHAR(255)  NULL,
    qty          DECIMAL(10,4) NOT NULL DEFAULT 1,
    unit_price   DECIMAL(12,4) NOT NULL DEFAULT 0,
    price_basis  ENUM('cost','wholesale','rrp','custom') NOT NULL DEFAULT 'custom',
    restock      TINYINT(1)    NOT NULL DEFAULT 1,
    tax_rate     DECIMAL(6,4)  NOT NULL DEFAULT 0,
    line_total   DECIMAL(12,4) NOT NULL DEFAULT 0,
    INDEX idx_cn (cn_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_supplier_credit_notes (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    business_id         VARCHAR(150) NOT NULL,
    scn_number          VARCHAR(30)  NOT NULL,
    supplier_id         INT          NULL,
    po_id               INT          NULL,
    location_id         INT          NOT NULL,
    status              ENUM('draft','complete','cancelled') NOT NULL DEFAULT 'draft',
    scn_date            DATE         NOT NULL,
    completed_at        DATETIME     NULL,
    reference           VARCHAR(255) NULL,
    supplier_credit_ref VARCHAR(100) NULL,
    currency_code       VARCHAR(10)  NOT NULL DEFAULT 'AUD',
    exchange_rate       DECIMAL(12,6) NOT NULL DEFAULT 1.000000,
    tax_treatment       ENUM('ex_tax','inc_tax','no_tax') NOT NULL DEFAULT 'ex_tax',
    subtotal            DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
    notes               TEXT         NULL,
    xero_credit_note_id VARCHAR(100) NULL,
    xero_synced_at      DATETIME     NULL,
    xero_sync_status    ENUM('synced','queued','error') NULL,
    created_by          VARCHAR(150) NULL,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_business_scn (business_id, scn_number),
    INDEX idx_business (business_id),
    INDEX idx_status (status),
    INDEX idx_supplier (supplier_id),
    INDEX idx_po (po_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_supplier_credit_note_items (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    scn_id       INT           NOT NULL,
    variant_id   VARCHAR(100)  NULL,
    code         VARCHAR(100)  NULL,
    name         VARCHAR(255)  NULL,
    qty          DECIMAL(10,4) NOT NULL DEFAULT 1,
    unit_cost    DECIMAL(12,4) NOT NULL DEFAULT 0,
    restock      TINYINT(1)    NOT NULL DEFAULT 1,
    tax_rate     DECIMAL(6,4)  NOT NULL DEFAULT 0,
    line_total   DECIMAL(12,4) NOT NULL DEFAULT 0,
    INDEX idx_scn (scn_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_supplier_credit_note_files (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    scn_id        INT          NOT NULL,
    business_id   VARCHAR(100) NOT NULL,
    filename      VARCHAR(255) NOT NULL,
    original_name VARCHAR(255),
    mime_type     VARCHAR(100),
    file_size     INT,
    uploaded_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_scn (scn_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // Bootstrap safety: some tenants only got this table via the older one-off
  // scripts/add-product-images.mjs / _create-product-images-table.mjs, which
  // never made it into this catch-up script or the base ims-schema.sql —
  // create it here (with updated_at from the start) for any tenant missing it.
  `CREATE TABLE IF NOT EXISTS ims_product_images (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    product_id    VARCHAR(36) NOT NULL,
    url           TEXT NOT NULL,
    source        ENUM('shopify','google_drive','external') NOT NULL DEFAULT 'external',
    drive_file_id VARCHAR(200) NULL,
    is_primary    TINYINT(1) NOT NULL DEFAULT 0,
    sort_order    INT NOT NULL DEFAULT 0,
    alt_text      VARCHAR(255) NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES ims_products(product_id) ON DELETE CASCADE,
    INDEX idx_pi_product (product_id),
    INDEX idx_pi_primary (product_id, is_primary)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

// Column definitions: [table, column, definition]
const COLUMNS = [
  ['ims_cs_learning_evidence', 'processed_at', 'DATETIME NULL'],
  // ── ims_product_images ───────────────────────────────────────────────────
  // Additive column for tenants where the table already existed (created by
  // the older add-product-images.mjs / _create-product-images-table.mjs
  // scripts) but predates this updated_at addition — enables incremental
  // "since" image sync from the POS product cache.
  ['ims_product_images', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  // ── ims_purchase_orders ──────────────────────────────────────────────────
  ['ims_purchase_orders', 'xero_bill_id',            'VARCHAR(100) NULL'],
  ['ims_purchase_orders', 'xero_synced_at',           'DATETIME NULL'],
  ['ims_purchase_orders', 'xero_sync_status',         "ENUM('synced','queued','error') NULL"],
  ['ims_purchase_orders', 'cin7_order_id',            'VARCHAR(50) NULL'],
  ['ims_purchase_orders', 'is_historical',            'TINYINT(1) NOT NULL DEFAULT 0'],
  ['ims_purchase_orders', 'supplier_invoice_number',  'VARCHAR(100) NULL'],
  ['ims_purchase_orders', 'supplier_invoice_date',    'DATE NULL'],
  ['ims_purchase_orders', 'payment_terms',            'VARCHAR(100) NULL'],
  ['ims_purchase_orders', 'currency_code',            "VARCHAR(10) NOT NULL DEFAULT 'AUD'"],
  ['ims_purchase_orders', 'exchange_rate',            'DECIMAL(12,6) NOT NULL DEFAULT 1.000000'],
  ['ims_purchase_orders', 'cin7_contact_id',          'INT NULL'],
  ['ims_purchase_orders', 'tax_treatment',            "ENUM('ex_tax','inc_tax','no_tax') NOT NULL DEFAULT 'ex_tax'"],
  ['ims_purchase_orders', 'tax_code',                 'VARCHAR(50) NULL'],
  ['ims_purchase_orders', 'supplier_name_raw',        'VARCHAR(255) NULL'],
  // ── ims_sales_orders ─────────────────────────────────────────────────────
  ['ims_sales_orders', 'customer_po_number',  'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'xero_invoice_id',     'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'xero_synced_at',      'DATETIME NULL'],
  ['ims_sales_orders', 'xero_sync_status',    "ENUM('synced','queued','error') NULL"],
  ['ims_sales_orders', 'shopify_order_name',  'VARCHAR(50) NULL'],
  ['ims_sales_orders', 'cin7_order_id',       'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'is_historical',       'TINYINT(1) NOT NULL DEFAULT 0'],
  ['ims_sales_orders', 'payment_terms',       'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'freight',             'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
  ['ims_sales_orders', 'discount',            'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
  ['ims_sales_orders', 'currency_code',       "VARCHAR(10) NOT NULL DEFAULT 'AUD'"],
  ['ims_sales_orders', 'exchange_rate',       'DECIMAL(12,6) NOT NULL DEFAULT 1.000000'],
  ['ims_sales_orders', 'cin7_member_id',      'INT NULL'],
  ['ims_sales_orders', 'tax_code',            'VARCHAR(50) NULL'],
  ['ims_sales_orders', 'payment_gateway',     'VARCHAR(255) NULL'],
  ['ims_sales_orders', 'refunded_amount',     'DECIMAL(12,2) NOT NULL DEFAULT 0.00'],
  ['ims_sales_orders', 'financial_status',    'VARCHAR(50) NULL'],
  ['ims_sales_orders', 'returned_at',         'DATETIME NULL'],
  // ── pos_eod_reconciliations ─────────────────────────────────────────────
  ['pos_eod_reconciliations', 'xero_payment_required',      'TINYINT(1) NOT NULL DEFAULT 0'],
  ['pos_eod_reconciliations', 'xero_payment_id',            'VARCHAR(100) NULL'],
  ['pos_eod_reconciliations', 'xero_payment_synced_at',     'DATETIME NULL'],
  ['pos_eod_reconciliations', 'xero_payment_error',         'TEXT NULL'],
  ['pos_eod_reconciliations', 'xero_clearing_account_code', 'VARCHAR(20) NULL'],
  // ── ims_credit_notes ─────────────────────────────────────────────────────
  ['ims_credit_notes', 'so_id',               'INT NULL'],
  ['ims_credit_notes', 'original_so_number',  'VARCHAR(100) NULL'],
  ['ims_credit_notes', 'source',              "ENUM('manual','shopify','pos') NOT NULL DEFAULT 'manual'"],
  ['ims_credit_notes', 'pos_sale_id',         'INT NULL'],
  ['ims_credit_notes', 'settlement_method',   "ENUM('store_credit','refund','external') NOT NULL DEFAULT 'store_credit'"],
  ['ims_credit_notes', 'settlement_status',   "ENUM('pending','complete','error') NOT NULL DEFAULT 'pending'"],
  ['ims_credit_notes', 'store_credit_transaction_id', 'INT NULL'],
  ['ims_credit_notes', 'shopify_return_id',   'VARCHAR(100) NULL'],
  ['ims_credit_notes', 'completed_at',        'DATETIME NULL'],
  ['ims_credit_notes', 'xero_credit_note_id', 'VARCHAR(100) NULL'],
  ['ims_credit_notes', 'xero_synced_at',      'DATETIME NULL'],
  ['ims_credit_notes', 'xero_sync_status',    "ENUM('synced','queued','error') NULL"],
  ['ims_credit_notes', 'created_by',          'VARCHAR(150) NULL'],
  // ── ims_credit_note_items ────────────────────────────────────────────────
  ['ims_credit_note_items', 'price_basis',    "ENUM('cost','wholesale','rrp','custom') NOT NULL DEFAULT 'custom'"],
  ['ims_credit_note_items', 'restock',        'TINYINT(1) NOT NULL DEFAULT 1'],
  // ── ims_supplier_credit_notes ────────────────────────────────────────────
  ['ims_supplier_credit_notes', 'supplier_credit_ref', 'VARCHAR(100) NULL'],
  ['ims_supplier_credit_notes', 'currency_code',       "VARCHAR(10) NOT NULL DEFAULT 'AUD'"],
  ['ims_supplier_credit_notes', 'exchange_rate',       'DECIMAL(12,6) NOT NULL DEFAULT 1.000000'],
  ['ims_supplier_credit_notes', 'xero_credit_note_id', 'VARCHAR(100) NULL'],
  ['ims_supplier_credit_notes', 'xero_synced_at',      'DATETIME NULL'],
  ['ims_supplier_credit_notes', 'xero_sync_status',    "ENUM('synced','queued','error') NULL"],
  ['ims_supplier_credit_notes', 'created_by',          'VARCHAR(150) NULL'],
  // ── ims_supplier_credit_note_items ───────────────────────────────────────
  ['ims_supplier_credit_note_items', 'restock',        'TINYINT(1) NOT NULL DEFAULT 1'],
  // ── ims_product_variants ─────────────────────────────────────────────────
  ['ims_product_variants', 'cost_aud',                  'DECIMAL(12,4) NULL'],
  ['ims_product_variants', 'avg_cost',                  'DECIMAL(15,4) NULL'],
  ['ims_product_variants', 'price_rrp',                 'DECIMAL(12,2) NULL'],
  ['ims_product_variants', 'price_wholesale',           'DECIMAL(10,4) NULL'],
  ['ims_product_variants', 'price_rrp_sale',            'DECIMAL(12,2) NULL'],
  ['ims_product_variants', 'cost_foreign',              'TEXT NULL'],
  ['ims_product_variants', 'pack_size',                 'INT NULL'],
  ['ims_product_variants', 'cin7_option_id',            'INT NULL'],
  ['ims_product_variants', 'bin',                       'VARCHAR(100) NULL'],
  ['ims_product_variants', 'zone',                      'VARCHAR(100) NULL'],
  ['ims_product_variants', 'volume',                    'TINYINT UNSIGNED NULL'],
  ['ims_product_variants', 'shopify_inventory_item_id', 'VARCHAR(100) NULL'],
  // ── ims_stock ────────────────────────────────────────────────────────────
  ['ims_stock', 'zone', 'VARCHAR(50) NULL'],
  ['ims_stock', 'bin',  'VARCHAR(50) NULL'],
  // ── ims_locations ────────────────────────────────────────────────────────
  ['ims_locations', 'phone',          'VARCHAR(50) NULL'],
  ['ims_locations', 'pos_pin',        'VARCHAR(20) NULL'],
  ['ims_locations', 'manager_pin_hash', 'VARCHAR(255) NULL'],
  ['ims_locations', 'cin7_branch_id', 'INT NULL'],
  ['ims_locations', 'has_pos',        'TINYINT(1) NOT NULL DEFAULT 0'],
  ['ims_locations', 'has_wholesale',  'TINYINT(1) NOT NULL DEFAULT 0'],
  ['ims_locations', 'has_online',     'TINYINT(1) NOT NULL DEFAULT 0'],
  // ── ims_contacts ─────────────────────────────────────────────────────────
  ['ims_contacts', 'password_hash',   'VARCHAR(255) NULL'],
  ['ims_contacts', 'cin7_contact_id', 'INT NULL'],
  ['ims_contacts', 'shopify_customer_id', 'VARCHAR(100) NULL'],
  // ── pos_sales / store_credit_transactions ───────────────────────────────
  ['pos_sales', 'customer_id',       'INT NULL'],
  ['pos_sales', 'credit_note_id',    'INT NULL'],
  ['store_credit_transactions', 'credit_note_id',   'INT NULL'],
  ['store_credit_transactions', 'idempotency_key',  'VARCHAR(191) NULL'],
];

const INDEXES = [
  ['ims_contacts', 'idx_shopify_customer_id', 'UNIQUE INDEX `idx_shopify_customer_id` (`business_id`, `shopify_customer_id`)'],
  ['ims_credit_notes', 'idx_shopify_return', 'INDEX `idx_shopify_return` (`business_id`, `shopify_return_id`)'],
  ['ims_credit_notes', 'uq_cn_pos_sale', 'UNIQUE INDEX `uq_cn_pos_sale` (`business_id`, `pos_sale_id`)'],
  ['pos_sales', 'idx_ps_customer', 'INDEX `idx_ps_customer` (`customer_id`)'],
  ['pos_sales', 'uq_ps_credit_note', 'UNIQUE INDEX `uq_ps_credit_note` (`business_id`, `credit_note_id`)'],
  ['store_credit_transactions', 'idx_sct_credit_note', 'INDEX `idx_sct_credit_note` (`credit_note_id`)'],
  ['store_credit_transactions', 'uq_sct_idempotency', 'UNIQUE INDEX `uq_sct_idempotency` (`idempotency_key`)'],
  ['ims_supplier_credit_notes', 'uq_business_scn', 'UNIQUE INDEX `uq_business_scn` (`business_id`, `scn_number`)'],
];

async function ensureEnumValues(schema, table, column, requiredValues) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`,
    [schema, table, column],
  );
  const row = rows[0];
  if (!row || typeof row.COLUMN_TYPE !== 'string' || !row.COLUMN_TYPE.toLowerCase().startsWith('enum(')) return;

  const existingValues = [];
  const regex = /'((?:[^'\\]|\\.)*)'/g;
  let match;
  while ((match = regex.exec(row.COLUMN_TYPE)) !== null) {
    existingValues.push(match[1].replace(/\\'/g, "'"));
  }

  const missing = requiredValues.filter(v => !existingValues.includes(v));
  if (!missing.length) return;

  const merged = [...existingValues, ...missing];
  const enumSql = merged.map(v => `'${String(v).replace(/'/g, "\\'")}'`).join(',');
  const nullSql = row.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
  const defaultSql = row.COLUMN_DEFAULT === null ? '' : ` DEFAULT ${conn.escape(row.COLUMN_DEFAULT)}`;

  await conn.query(
    `ALTER TABLE \`${schema}\`.\`${table}\` MODIFY COLUMN \`${column}\` ENUM(${enumSql}) ${nullSql}${defaultSql}`,
  );
}

async function migrateSchema(schema) {
  for (const ddl of TABLE_DDLS) {
    try {
      await conn.query(`USE \`${schema}\``);
      await conn.query(ddl);
    } catch (e) {
      console.error(`  ✗ ${schema} table bootstrap: ${e.message}`);
    }
  }

  // Load existing columns once per schema
  const [rows] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`,
    [schema],
  );
  const existing = new Set(rows.map(r => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));
  const [indexRows] = await conn.query(
    `SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?`,
    [schema],
  );
  const existingIndexes = new Set(indexRows.map(r => `${r.TABLE_NAME}.${r.INDEX_NAME}`));

  let added = 0, skipped = 0;
  for (const [table, col, def] of COLUMNS) {
    if (existing.has(`${table}.${col}`)) { skipped++; continue; }
    try {
      await conn.query(`ALTER TABLE \`${schema}\`.\`${table}\` ADD COLUMN \`${col}\` ${def}`);
      added++;
    } catch (e) {
      console.error(`  ✗ ${schema}.${table}.${col}: ${e.message}`);
    }
  }

  let indexesAdded = 0, indexesSkipped = 0;
  for (const [table, indexName, def] of INDEXES) {
    if (existingIndexes.has(`${table}.${indexName}`)) { indexesSkipped++; continue; }
    try {
      await conn.query(`ALTER TABLE \`${schema}\`.\`${table}\` ADD ${def}`);
      indexesAdded++;
    } catch (e) {
      console.error(`  ✗ ${schema}.${table}.${indexName}: ${e.message}`);
    }
  }

  try {
    await ensureEnumValues(schema, 'ims_credit_notes', 'status', ['draft', 'awaiting_product', 'complete', 'cancelled']);
    await ensureEnumValues(schema, 'ims_credit_notes', 'source', ['manual', 'shopify', 'pos']);
    await ensureEnumValues(schema, 'ims_stock_movements', 'movement_type', ['cn_returned', 'scn_returned']);
    await ensureEnumValues(schema, 'ims_stock_movements', 'reference_type', ['credit_note', 'supplier_credit_note']);
  } catch (e) {
    console.error(`  ✗ ${schema} enum catch-up: ${e.message}`);
  }

  console.log(`✓ ${schema}: added ${added} columns, skipped ${skipped}, added ${indexesAdded} indexes, skipped ${indexesSkipped}`);
}

try {
  const schemas = new Set();
  if (process.env.IMS_MYSQL_DATABASE) schemas.add(process.env.IMS_MYSQL_DATABASE);
  const mainDb = process.env.MYSQL_DATABASE;
  if (mainDb) {
    const [rows] = await conn.query(
      `SELECT ims_db_name FROM \`${mainDb}\`.businesses WHERE ims_db_name IS NOT NULL AND deleted_at IS NULL`,
    );
    for (const r of rows) if (r.ims_db_name) schemas.add(r.ims_db_name);
  }
  console.log(`Schemas: ${[...schemas].join(', ')}`);
  for (const schema of schemas) await migrateSchema(schema);
  console.log('Done.');
} finally {
  await conn.end();
}
