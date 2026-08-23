/**
 * Catch-up migration: add all columns that exist in Monsterthreads but are
 * missing from other IMS tenant schemas.
 *
 * Safe to re-run — uses ADD COLUMN IF NOT EXISTS throughout.
 * Run: node scripts/catchup-schema-all-tenants.mjs
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ONLINE_SHOP_TABLES = [
  'ims_online_shop_products',
  'ims_online_shop_customers',
  'ims_online_shop_addresses',
  'ims_online_shop_shipping_rules',
  'ims_online_shop_pickup_locations',
  'ims_online_shop_checkouts',
  'ims_online_shop_fulfilment_groups',
  'ims_online_shop_checkout_items',
  'ims_online_shop_stock_reservations',
  'ims_online_shop_payment_attempts',
  'ims_online_shop_payment_events',
  'ims_online_shop_value_reservations',
  'ims_online_shop_refunds',
];

const canonicalImsSchema = await fs.readFile(path.join(__dirname, 'ims-schema.sql'), 'utf8');
const ONLINE_SHOP_TABLE_DDLS = ONLINE_SHOP_TABLES.map(table => {
  const expression = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  const match = canonicalImsSchema.match(expression);
  if (!match) throw new Error(`Canonical IMS definition not found for ${table}.`);
  return match[0]
    .replace(/^\s*CONSTRAINT (?:fk_online_shop_product|fk_online_checkout_item_variant|fk_online_stock_reservation_variant)\b[^\n]*,?\r?\n/gm, '')
    .replace(/,\s*(\) ENGINE=)/, '\n$1')
    .replace(/;$/, '');
});

const conn = await mysql.createConnection({
  host:           process.env.MYSQL_HOST,
  port:           parseInt(process.env.MYSQL_PORT || '3306'),
  user:           process.env.MYSQL_USER,
  password:       process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

const TABLE_DDLS = [
  `CREATE TABLE IF NOT EXISTS ims_crm_interactions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, contact_id INT NOT NULL,
    interaction_type VARCHAR(32) NOT NULL DEFAULT 'note', body MEDIUMTEXT NOT NULL, occurred_at DATETIME NULL,
    actor_id INT NULL, actor_name VARCHAR(255) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_crm_interaction_timeline (business_id, contact_id, occurred_at, id),
    CONSTRAINT fk_crm_interaction_contact FOREIGN KEY (contact_id) REFERENCES ims_contacts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_crm_tasks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, contact_id INT NOT NULL,
    title VARCHAR(255) NOT NULL, description TEXT NULL, due_date DATE NULL,
    priority VARCHAR(16) NOT NULL DEFAULT 'normal', status VARCHAR(16) NOT NULL DEFAULT 'open',
    assigned_user_id INT NULL, assigned_user_name VARCHAR(255) NULL,
    created_by INT NULL, created_by_name VARCHAR(255) NULL,
    completed_by INT NULL, completed_by_name VARCHAR(255) NULL, completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_crm_task_contact (business_id, contact_id, status, due_date, id),
    INDEX idx_crm_task_assignee (business_id, assigned_user_id, status, due_date),
    CONSTRAINT fk_crm_task_contact FOREIGN KEY (contact_id) REFERENCES ims_contacts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_crm_tags (
    id INT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, name VARCHAR(100) NOT NULL,
    normalized_name VARCHAR(100) NOT NULL, color VARCHAR(32) NULL,
    created_by INT NULL, created_by_name VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_tag_name (business_id, normalized_name), INDEX idx_crm_tag_lookup (business_id, name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_crm_contact_tags (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, contact_id INT NOT NULL, tag_id INT NOT NULL,
    created_by INT NULL, created_by_name VARCHAR(255) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_contact_tag (business_id, contact_id, tag_id),
    INDEX idx_crm_contact_tag_lookup (business_id, tag_id, contact_id),
    CONSTRAINT fk_crm_contact_tag_contact FOREIGN KEY (contact_id) REFERENCES ims_contacts(id) ON DELETE CASCADE,
    CONSTRAINT fk_crm_contact_tag_tag FOREIGN KEY (tag_id) REFERENCES ims_crm_tags(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_crm_segments (
    id INT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, name VARCHAR(120) NOT NULL,
    normalized_name VARCHAR(120) NOT NULL, description VARCHAR(500) NULL, rules_json JSON NOT NULL,
    created_by INT NULL, created_by_name VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_segment_name (business_id, normalized_name), INDEX idx_crm_segment_lookup (business_id, name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_crm_pipeline_stages (
    id INT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, name VARCHAR(80) NOT NULL,
    normalized_name VARCHAR(80) NOT NULL, position INT NOT NULL DEFAULT 0, category VARCHAR(16) NOT NULL DEFAULT 'open',
    default_probability INT NOT NULL DEFAULT 0, color VARCHAR(32) NULL, is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_pipeline_stage_name (business_id, normalized_name),
    INDEX idx_crm_pipeline_stage_order (business_id, is_active, position, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_crm_opportunities (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, contact_id INT NOT NULL, stage_id INT NOT NULL,
    title VARCHAR(255) NOT NULL, description TEXT NULL, expected_value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    probability INT NOT NULL DEFAULT 0, owner_user_id INT NULL, owner_name VARCHAR(255) NULL,
    next_action_date DATE NULL, lost_reason VARCHAR(500) NULL, created_by INT NULL, created_by_name VARCHAR(255) NULL,
    closed_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_crm_opportunity_stage (business_id, stage_id, next_action_date, id),
    INDEX idx_crm_opportunity_contact (business_id, contact_id, id),
    INDEX idx_crm_opportunity_owner (business_id, owner_user_id, stage_id),
    CONSTRAINT fk_crm_opportunity_contact FOREIGN KEY (contact_id) REFERENCES ims_contacts(id) ON DELETE CASCADE,
    CONSTRAINT fk_crm_opportunity_stage FOREIGN KEY (stage_id) REFERENCES ims_crm_pipeline_stages(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_crm_contact_merges (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL,
    source_contact_id INT NOT NULL, target_contact_id INT NOT NULL,
    source_snapshot_json JSON NOT NULL, target_snapshot_json JSON NOT NULL,
    merged_by INT NULL, merged_by_name VARCHAR(255) NULL, merged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_crm_contact_merge_source (business_id, source_contact_id, merged_at),
    INDEX idx_crm_contact_merge_target (business_id, target_contact_id, merged_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_purchase_order_payments (
    id INT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL DEFAULT '', po_id INT NOT NULL,
    payment_date DATE NOT NULL, amount DECIMAL(12,4) NOT NULL, currency_code VARCHAR(10) NOT NULL DEFAULT 'AUD',
    exchange_rate DECIMAL(12,6) NOT NULL DEFAULT 1.000000, amount_local DECIMAL(12,4) NOT NULL,
    notes VARCHAR(500) NULL, payment_method_id INT NULL,
    xero_post_intent ENUM('solvantis_only','post_to_xero') NOT NULL DEFAULT 'solvantis_only',
    xero_post_status ENUM('not_requested','pending','posted','failed','unknown') NOT NULL DEFAULT 'not_requested',
    xero_payment_id VARCHAR(100) NULL, xero_post_error VARCHAR(500) NULL, xero_posted_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_pop_po (po_id),
    FOREIGN KEY (po_id) REFERENCES ims_purchase_orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_sales_order_payments (
    id INT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL DEFAULT '', so_id INT NOT NULL,
    payment_date DATE NOT NULL, amount DECIMAL(12,4) NOT NULL, currency_code VARCHAR(10) NOT NULL DEFAULT 'AUD',
    exchange_rate DECIMAL(12,6) NOT NULL DEFAULT 1.000000, amount_local DECIMAL(12,4) NOT NULL,
    notes VARCHAR(500) NULL, payment_method_id INT NULL,
    xero_post_intent ENUM('solvantis_only','post_to_xero') NOT NULL DEFAULT 'solvantis_only',
    xero_post_status ENUM('not_requested','pending','posted','failed','unknown') NOT NULL DEFAULT 'not_requested',
    xero_payment_id VARCHAR(100) NULL, xero_post_error VARCHAR(500) NULL, xero_posted_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_sop_so (so_id),
    FOREIGN KEY (so_id) REFERENCES ims_sales_orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_inventory_document_operations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, operation_key VARCHAR(191) NOT NULL,
    request_hash CHAR(64) NOT NULL, document_kind ENUM('customer_credit_note','supplier_credit_note','stocktake') NOT NULL,
    document_id INT NOT NULL, action VARCHAR(64) NOT NULL, previous_status VARCHAR(32) NOT NULL, resulting_status VARCHAR(32) NULL,
    state ENUM('processing','complete') NOT NULL DEFAULT 'processing', before_metadata_json JSON NULL,
    after_metadata_json JSON NULL, response_json JSON NULL, actor_id INT NULL, actor_name VARCHAR(255) NULL,
    safe_error VARCHAR(500) NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL,
    UNIQUE KEY uq_inventory_document_operation (business_id, operation_key),
    INDEX idx_inventory_document_history (business_id, document_kind, document_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_order_amendment_operations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, operation_key VARCHAR(191) NOT NULL,
    request_hash CHAR(64) NOT NULL, order_kind VARCHAR(32) NOT NULL, order_id INT NOT NULL, order_status VARCHAR(32) NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'processing', before_header_json JSON NULL, after_header_json JSON NULL,
    actor_id INT NULL, actor_name VARCHAR(255) NULL, safe_error VARCHAR(500) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL,
    UNIQUE KEY uq_order_amendment_operation (business_id, operation_key),
    INDEX idx_order_amendment_order (business_id, order_kind, order_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_order_amendment_lines (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, amendment_id BIGINT NOT NULL,
    source_line_id INT NULL, result_line_id INT NULL, moved_quantity_floor DECIMAL(12,4) NOT NULL DEFAULT 0,
    before_line_json JSON NULL, after_line_json JSON NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order_amendment_lines (business_id, amendment_id, id),
    CONSTRAINT fk_order_amendment_lines_operation FOREIGN KEY (amendment_id) REFERENCES ims_order_amendment_operations(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_so_shortfall_resolutions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, operation_key VARCHAR(191) NOT NULL,
    request_hash CHAR(64) NOT NULL, source_so_id INT NOT NULL,
    outcome ENUM('leave_partial','cancel_remainder','create_backorder') NOT NULL,
    settlement ENUM('none','refund','leave_unapplied','reserve_for_backorder') NOT NULL DEFAULT 'none',
    child_so_id INT NULL, credit_note_id INT NULL, outstanding_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    currency_code VARCHAR(10) NOT NULL DEFAULT 'AUD', accounting_action ENUM('none','resize_document','credit_note') NOT NULL DEFAULT 'none',
    state ENUM('processing','xero_pending','complete','failed','unknown') NOT NULL DEFAULT 'processing', safe_error VARCHAR(500) NULL,
    response_json JSON NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL,
    UNIQUE KEY uq_so_shortfall_operation (business_id, operation_key), INDEX idx_so_shortfall_source (business_id, source_so_id, created_at),
    INDEX idx_so_shortfall_child (business_id, child_so_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_customer_credit_settlements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, resolution_id BIGINT NOT NULL,
    action_key VARCHAR(191) NOT NULL, action_type ENUM('refund','leave_unapplied','reserve_for_order','allocate_to_invoice','allocate_to_source') NOT NULL,
    amount DECIMAL(12,2) NOT NULL, target_so_id INT NULL, target_xero_document_id VARCHAR(100) NULL, account_code VARCHAR(50) NULL,
    status ENUM('planned','running','succeeded','failed','unknown','released') NOT NULL DEFAULT 'planned', xero_id VARCHAR(100) NULL,
    safe_error VARCHAR(500) NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL,
    UNIQUE KEY uq_customer_credit_action (business_id, action_key), INDEX idx_customer_credit_resolution (business_id, resolution_id),
    INDEX idx_customer_credit_target (business_id, target_so_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_po_shortfall_resolutions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, operation_key VARCHAR(191) NOT NULL,
    request_hash CHAR(64) NOT NULL, source_po_id INT NOT NULL, outcome ENUM('leave_partial','cancel_remainder','create_backorder') NOT NULL,
    settlement ENUM('none','supplier_refund','leave_unapplied','reserve_for_new_po') NOT NULL DEFAULT 'none', child_po_id INT NULL,
    supplier_credit_note_id INT NULL, supplier_credit_ref VARCHAR(255) NULL, evidence_note VARCHAR(500) NULL,
    outstanding_amount DECIMAL(12,2) NOT NULL DEFAULT 0, currency_code VARCHAR(10) NOT NULL DEFAULT 'AUD',
    accounting_action ENUM('none','resize_document','credit_note') NOT NULL DEFAULT 'none',
    state ENUM('processing','xero_pending','complete','failed','unknown') NOT NULL DEFAULT 'processing', safe_error VARCHAR(500) NULL,
    response_json JSON NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL,
    UNIQUE KEY uq_po_shortfall_operation (business_id, operation_key), INDEX idx_po_shortfall_source (business_id, source_po_id, created_at),
    INDEX idx_po_shortfall_child (business_id, child_po_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_supplier_credit_settlements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, resolution_id BIGINT NOT NULL,
    action_key VARCHAR(191) NOT NULL, action_type ENUM('supplier_refund','leave_unapplied','reserve_for_order','allocate_to_bill','allocate_to_source') NOT NULL,
    amount DECIMAL(12,2) NOT NULL, target_po_id INT NULL, target_xero_document_id VARCHAR(100) NULL, account_code VARCHAR(50) NULL,
    status ENUM('planned','running','succeeded','failed','unknown','released') NOT NULL DEFAULT 'planned', xero_id VARCHAR(100) NULL,
    safe_error VARCHAR(500) NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL,
    UNIQUE KEY uq_supplier_credit_action (business_id, action_key), INDEX idx_supplier_credit_resolution (business_id, resolution_id),
    INDEX idx_supplier_credit_target (business_id, target_po_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_so_fulfilment_operations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    operation_key VARCHAR(191) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    so_id INT NOT NULL,
    status ENUM('processing','complete') NOT NULL DEFAULT 'processing',
    request_json JSON NULL,
    response_json JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    UNIQUE KEY uq_so_fulfilment_operation (business_id, operation_key),
    INDEX idx_so_fulfilment_order (business_id, so_id, created_at),
    CONSTRAINT fk_so_fulfilment_order FOREIGN KEY (so_id) REFERENCES ims_sales_orders(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_so_shipments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, so_id INT NOT NULL,
    shopify_fulfilment_id VARCHAR(100) NOT NULL, status VARCHAR(100) NULL,
    fulfilled_at DATETIME NULL, shopify_updated_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_so_shipment_shopify (business_id, shopify_fulfilment_id),
    INDEX idx_so_shipment_order (business_id, so_id, fulfilled_at, id),
    CONSTRAINT fk_so_shipment_order FOREIGN KEY (so_id) REFERENCES ims_sales_orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS ims_so_shipment_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, shipment_id BIGINT NOT NULL,
    shopify_line_item_id VARCHAR(100) NOT NULL, quantity DECIMAL(12,4) NOT NULL,
    INDEX idx_so_shipment_item (business_id, shipment_id, id),
    CONSTRAINT fk_so_shipment_item_shipment FOREIGN KEY (shipment_id) REFERENCES ims_so_shipments(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS ims_so_shipment_tracking (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, shipment_id BIGINT NOT NULL,
    company VARCHAR(255) NULL, tracking_number VARCHAR(255) NULL, tracking_url VARCHAR(2000) NULL,
    INDEX idx_so_shipment_tracking (business_id, shipment_id, id),
    CONSTRAINT fk_so_shipment_tracking_shipment FOREIGN KEY (shipment_id) REFERENCES ims_so_shipments(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS ims_po_receive_operations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    operation_key VARCHAR(191) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    po_id INT NOT NULL,
    status ENUM('processing','complete') NOT NULL DEFAULT 'processing',
    request_json JSON NULL,
    response_json JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    UNIQUE KEY uq_po_receive_operation (business_id, operation_key),
    INDEX idx_po_receive_order (business_id, po_id, created_at),
    CONSTRAINT fk_po_receive_order FOREIGN KEY (po_id) REFERENCES ims_purchase_orders(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS wholesale_draft_orders (
    id INT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(64) NOT NULL, contact_id INT NOT NULL,
    wholesale_company_id INT NULL, wholesale_location_id INT NULL, wholesale_member_id INT NULL,
    status ENUM('draft','submitted','cancelled') NOT NULL DEFAULT 'draft', reference VARCHAR(100) NULL,
    notes TEXT NULL, subtotal DECIMAL(10,2) NOT NULL DEFAULT 0, total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    submitted_at DATETIME NULL, so_id INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_biz_contact (business_id, contact_id),
    INDEX idx_wholesale_draft_account (business_id, wholesale_company_id, wholesale_location_id, wholesale_member_id),
    INDEX idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_wholesale_saved_lists (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL DEFAULT '', company_id INT NOT NULL,
    created_by_member_id INT NOT NULL, name VARCHAR(80) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wholesale_saved_list_name (business_id, company_id, name),
    INDEX idx_wholesale_saved_list_company (business_id, company_id, updated_at, id),
    CONSTRAINT fk_wholesale_saved_list_company FOREIGN KEY (company_id) REFERENCES ims_wholesale_companies(id) ON DELETE CASCADE,
    CONSTRAINT fk_wholesale_saved_list_member FOREIGN KEY (created_by_member_id) REFERENCES ims_wholesale_company_members(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_wholesale_saved_list_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL DEFAULT '', list_id BIGINT NOT NULL,
    variant_id VARCHAR(64) NOT NULL, quantity INT NOT NULL DEFAULT 1, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wholesale_saved_list_variant (business_id, list_id, variant_id),
    INDEX idx_wholesale_saved_list_items (business_id, list_id, id),
    CONSTRAINT fk_wholesale_saved_list_item_list FOREIGN KEY (list_id) REFERENCES ims_wholesale_saved_lists(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_wholesale_favourites (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL DEFAULT '', company_id INT NOT NULL,
    member_id INT NOT NULL, variant_id VARCHAR(64) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wholesale_favourite_variant (business_id, company_id, member_id, variant_id),
    INDEX idx_wholesale_favourites_member (business_id, company_id, member_id, created_at),
    CONSTRAINT fk_wholesale_favourite_company FOREIGN KEY (company_id) REFERENCES ims_wholesale_companies(id) ON DELETE CASCADE,
    CONSTRAINT fk_wholesale_favourite_member FOREIGN KEY (member_id) REFERENCES ims_wholesale_company_members(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_wholesale_member_locations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL DEFAULT '', company_id INT NOT NULL,
    member_id INT NOT NULL, location_id INT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wholesale_member_location (business_id, member_id, location_id),
    INDEX idx_wholesale_location_members (business_id, company_id, location_id, member_id),
    CONSTRAINT fk_wholesale_member_location_member FOREIGN KEY (member_id) REFERENCES ims_wholesale_company_members(id) ON DELETE CASCADE,
    CONSTRAINT fk_wholesale_member_location_location FOREIGN KEY (location_id) REFERENCES ims_wholesale_company_locations(id) ON DELETE CASCADE,
    CONSTRAINT fk_wholesale_member_location_company FOREIGN KEY (company_id) REFERENCES ims_wholesale_companies(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_wholesale_team_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL DEFAULT '', company_id INT NOT NULL,
    actor_member_id INT NULL, actor_name VARCHAR(255) NOT NULL, target_member_id INT NULL, target_contact_id INT NULL,
    target_name VARCHAR(255) NOT NULL, target_email VARCHAR(320) NOT NULL, action VARCHAR(32) NOT NULL,
    before_role VARCHAR(16) NULL, after_role VARCHAR(16) NULL, details_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_wholesale_team_events (business_id, company_id, created_at, id),
    CONSTRAINT fk_wholesale_team_event_company FOREIGN KEY (company_id) REFERENCES ims_wholesale_companies(id) ON DELETE CASCADE,
    CONSTRAINT fk_wholesale_team_event_actor FOREIGN KEY (actor_member_id) REFERENCES ims_wholesale_company_members(id) ON DELETE SET NULL,
    CONSTRAINT fk_wholesale_team_event_member FOREIGN KEY (target_member_id) REFERENCES ims_wholesale_company_members(id) ON DELETE SET NULL,
    CONSTRAINT fk_wholesale_team_event_contact FOREIGN KEY (target_contact_id) REFERENCES ims_contacts(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS wholesale_draft_order_items (
    id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, variant_id VARCHAR(64) NOT NULL,
    product_id VARCHAR(64) NOT NULL, product_name VARCHAR(255) NOT NULL, variant_label VARCHAR(255) NULL,
    sku VARCHAR(100) NULL, qty INT NOT NULL DEFAULT 1, unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(10,2) NOT NULL, is_indent TINYINT(1) NOT NULL DEFAULT 0,
    indent_qty DECIMAL(12,4) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_order (order_id), CONSTRAINT fk_wdoi_order FOREIGN KEY (order_id)
      REFERENCES wholesale_draft_orders(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_stock_allocations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL,
    so_id INT NOT NULL, so_item_id INT NOT NULL, po_id INT NOT NULL, po_item_id INT NOT NULL,
    variant_id VARCHAR(36) NOT NULL, location_id INT NOT NULL, qty_allocated DECIMAL(12,4) NOT NULL,
    qty_received_assigned DECIMAL(12,4) NOT NULL DEFAULT 0, qty_fulfilled DECIMAL(12,4) NOT NULL DEFAULT 0,
    source_expected_date DATE NULL, promised_date DATE NULL,
    promise_status ENUM('unpromised','confirmed','at_risk') NOT NULL DEFAULT 'unpromised',
    state ENUM('active','fulfilled','released','cancelled') NOT NULL DEFAULT 'active', priority INT NOT NULL DEFAULT 0,
    override_reason VARCHAR(500) NULL, risk_reason VARCHAR(500) NULL, created_by INT NULL, created_by_name VARCHAR(255) NULL,
    released_by INT NULL, released_by_name VARCHAR(255) NULL, released_reason VARCHAR(500) NULL,
    revision INT NOT NULL DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, released_at DATETIME NULL,
    INDEX idx_stock_allocation_so (business_id, so_id, so_item_id, state),
    INDEX idx_stock_allocation_po (business_id, po_id, po_item_id, state),
    INDEX idx_stock_allocation_supply (business_id, variant_id, location_id, state, priority),
    INDEX idx_stock_allocation_promise (business_id, promise_status, promised_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_stock_allocation_operations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(100) NOT NULL, operation_key VARCHAR(191) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    action ENUM('allocate','resize','release','reassign','revise_promise','merge_retarget') NOT NULL,
    allocation_id BIGINT NULL, state ENUM('processing','complete') NOT NULL DEFAULT 'processing',
    request_json JSON NULL, response_json JSON NULL, actor_id INT NULL, actor_name VARCHAR(255) NULL,
    safe_error VARCHAR(500) NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL,
    UNIQUE KEY uq_stock_allocation_operation (business_id, operation_key),
    INDEX idx_stock_allocation_history (business_id, allocation_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_backorder_merges (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    operation_key VARCHAR(191) NOT NULL,
    request_hash CHAR(64) NULL,
    backorder_type ENUM('customer','supplier') NOT NULL,
    target_order_id INT NOT NULL,
    source_order_ids JSON NOT NULL,
    response_json JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    UNIQUE KEY uq_backorder_merge_operation (business_id, operation_key),
    INDEX idx_backorder_merge_target (business_id, backorder_type, target_order_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_po_backorder_lines (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    operation_key VARCHAR(191) NOT NULL,
    source_po_id INT NOT NULL,
    source_po_item_id INT NOT NULL,
    backorder_po_id INT NOT NULL,
    backorder_po_item_id INT NOT NULL,
    transferred_qty DECIMAL(12,4) NOT NULL,
    source_item_snapshot JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_po_backorder_operation_line (business_id, operation_key, source_po_item_id),
    INDEX idx_po_backorder_source (business_id, source_po_id),
    INDEX idx_po_backorder_destination (business_id, backorder_po_id),
    CONSTRAINT fk_po_backorder_source_order FOREIGN KEY (source_po_id) REFERENCES ims_purchase_orders(id),
    CONSTRAINT fk_po_backorder_destination_order FOREIGN KEY (backorder_po_id) REFERENCES ims_purchase_orders(id),
    CONSTRAINT fk_po_backorder_destination_item FOREIGN KEY (backorder_po_item_id) REFERENCES ims_purchase_order_items(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_so_backorder_lines (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    operation_key VARCHAR(191) NOT NULL,
    source_so_id INT NOT NULL,
    source_so_item_id INT NOT NULL,
    backorder_so_id INT NOT NULL,
    backorder_so_item_id INT NOT NULL,
    transferred_qty DECIMAL(12,4) NOT NULL,
    source_item_snapshot JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_so_backorder_operation_line (business_id, operation_key, source_so_item_id),
    INDEX idx_so_backorder_source (business_id, source_so_id),
    INDEX idx_so_backorder_destination (business_id, backorder_so_id),
    CONSTRAINT fk_so_backorder_source_order FOREIGN KEY (source_so_id) REFERENCES ims_sales_orders(id),
    CONSTRAINT fk_so_backorder_destination_order FOREIGN KEY (backorder_so_id) REFERENCES ims_sales_orders(id),
    CONSTRAINT fk_so_backorder_destination_item FOREIGN KEY (backorder_so_item_id) REFERENCES ims_sales_order_items(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS pos_chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    location_id INT NOT NULL,
    location_name VARCHAR(255) NOT NULL DEFAULT '',
    user_name VARCHAR(255) NOT NULL DEFAULT '',
    avatar VARCHAR(100) NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    to_location_id INT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pos_chat_created (created_at),
    INDEX idx_pos_chat_dm (location_id, to_location_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS pos_chat_attachments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    message_id INT NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INT UNSIGNED NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pos_chat_attachment_message (message_id),
    CONSTRAINT fk_pos_chat_attachment_message FOREIGN KEY (message_id)
      REFERENCES pos_chat_messages(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS pos_petty_cash_transactions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    operation_key VARCHAR(191) NOT NULL,
    location_id INT NOT NULL,
    register_id INT NULL,
    register_session_id INT NOT NULL,
    transaction_date DATE NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    gst_treatment ENUM('gst','bas_excluded') NOT NULL DEFAULT 'gst',
    gst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    reason VARCHAR(500) NOT NULL,
    evidence_type ENUM('receipt','admin_attestation') NOT NULL DEFAULT 'receipt',
    evidence_note VARCHAR(500) NULL,
    receipt_original_name VARCHAR(255) NOT NULL,
    receipt_stored_name VARCHAR(255) NOT NULL,
    receipt_mime_type VARCHAR(100) NOT NULL,
    receipt_file_size INT UNSIGNED NOT NULL,
    cashier_id INT NULL,
    cashier_name VARCHAR(255) NULL,
    status ENUM('recorded','voided') NOT NULL DEFAULT 'recorded',
    voided_at DATETIME NULL,
    voided_by_name VARCHAR(255) NULL,
    void_reason VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_pos_petty_cash_operation (business_id, operation_key),
    INDEX idx_pos_petty_cash_session (business_id, register_session_id, status),
    INDEX idx_pos_petty_cash_location_date (business_id, location_id, transaction_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_website_content_attempts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    outcome VARCHAR(32) NOT NULL,
    workflow VARCHAR(32) NOT NULL DEFAULT 'pending_online_bulk',
    candidate_urls_json MEDIUMTEXT NOT NULL,
    decisions_json MEDIUMTEXT NOT NULL,
    attempted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_website_attempt_product (business_id, product_id, outcome, attempted_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
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
    is_starred TINYINT(1) NOT NULL DEFAULT 0,
    starred_at DATETIME NULL,
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
    status              ENUM('draft','awaiting_product','complete','cancelled','reversed') NOT NULL DEFAULT 'draft',
    source              ENUM('manual','shopify','pos') NOT NULL DEFAULT 'manual',
    pos_sale_id         INT          NULL,
    settlement_method   ENUM('store_credit','refund','external') NOT NULL DEFAULT 'store_credit',
    settlement_status   ENUM('pending','complete','error') NOT NULL DEFAULT 'pending',
    store_credit_transaction_id INT NULL,
    shopify_return_id   VARCHAR(100) NULL,
    cn_date             DATE         NOT NULL,
    completed_at        DATETIME     NULL,
    reversed_at         DATETIME     NULL,
    reversal_reason     VARCHAR(500) NULL,
    reversed_by         INT          NULL,
    reference           VARCHAR(255) NULL,
    tax_treatment       ENUM('ex_tax','inc_tax','no_tax') NOT NULL DEFAULT 'ex_tax',
    tax_code            VARCHAR(50)  NULL,
    subtotal            DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
    notes               TEXT         NULL,
    xero_credit_note_id VARCHAR(100) NULL,
    xero_synced_at      DATETIME     NULL,
    xero_sync_status    ENUM('synced','queued','error') NULL,
    xero_correction_status ENUM('not_required','queued','synced','error','blocked') NULL,
    xero_correction_reference VARCHAR(100) NULL,
    xero_correction_error TEXT NULL,
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
    status              ENUM('draft','complete','cancelled','reversed') NOT NULL DEFAULT 'draft',
    scn_date            DATE         NOT NULL,
    completed_at        DATETIME     NULL,
    reversed_at         DATETIME     NULL,
    reversal_reason     VARCHAR(500) NULL,
    reversed_by         INT          NULL,
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
    xero_correction_status ENUM('not_required','queued','synced','error','blocked') NULL,
    xero_correction_reference VARCHAR(100) NULL,
    xero_correction_error TEXT NULL,
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
  `CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    contact_id INT NOT NULL,
    balance_points INT NOT NULL DEFAULT 0,
    lifetime_earned BIGINT UNSIGNED NOT NULL DEFAULT 0,
    lifetime_redeemed BIGINT UNSIGNED NOT NULL DEFAULT 0,
    status ENUM('active','suspended','closed') NOT NULL DEFAULT 'active',
    enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_loyalty_account (business_id, contact_id),
    INDEX idx_loyalty_account_business (business_id),
    CONSTRAINT fk_loyalty_account_contact FOREIGN KEY (contact_id) REFERENCES ims_contacts(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    account_id INT NOT NULL,
    type ENUM('earn','redeem','earn_reversal','redeem_reversal','adjustment','migration') NOT NULL,
    points_delta INT NOT NULL,
    balance_after INT NOT NULL,
    eligible_spend_cents INT UNSIGNED NULL,
    channel ENUM('pos','shopify','manual','migration') NOT NULL,
    source_type VARCHAR(50) NULL,
    source_id VARCHAR(191) NULL,
    idempotency_key VARCHAR(191) NULL,
    actor_id VARCHAR(150) NULL,
    reason VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_loyalty_transaction_idempotency (business_id, idempotency_key),
    INDEX idx_loyalty_transaction_account (business_id, account_id, created_at),
    INDEX idx_loyalty_transaction_source (business_id, source_type, source_id),
    INDEX idx_loyalty_transaction_type (business_id, type, created_at),
    CONSTRAINT fk_loyalty_transaction_account FOREIGN KEY (account_id) REFERENCES loyalty_accounts(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS loyalty_rewards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    reward_code VARCHAR(50) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    points_cost INT UNSIGNED NOT NULL,
    value_aud DECIMAL(12,2) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    shopify_discount_template_id VARCHAR(100) NULL,
    metadata_json MEDIUMTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_loyalty_reward_code (business_id, reward_code),
    INDEX idx_loyalty_reward_active (business_id, is_active, sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS loyalty_redemptions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL,
    account_id INT NOT NULL,
    reward_id INT NOT NULL,
    transaction_id BIGINT NOT NULL,
    status ENUM('reserved','issued','used','cancelled','expired') NOT NULL DEFAULT 'reserved',
    points_deducted INT UNSIGNED NOT NULL,
    idempotency_key VARCHAR(191) NOT NULL,
    pos_sale_id INT NULL,
    shopify_discount_id VARCHAR(100) NULL,
    voucher_code VARCHAR(100) NULL,
    used_at DATETIME NULL,
    cancelled_at DATETIME NULL,
    cancelled_reason VARCHAR(500) NULL,
    actor_id VARCHAR(150) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_loyalty_redemption_idempotency (business_id, idempotency_key),
    INDEX idx_loyalty_redemption_account (business_id, account_id, status, created_at),
    INDEX idx_loyalty_redemption_status (business_id, status, created_at),
    INDEX idx_loyalty_redemption_voucher (business_id, voucher_code),
    CONSTRAINT fk_loyalty_redemption_account FOREIGN KEY (account_id) REFERENCES loyalty_accounts(id) ON DELETE RESTRICT,
    CONSTRAINT fk_loyalty_redemption_reward FOREIGN KEY (reward_id) REFERENCES loyalty_rewards(id) ON DELETE RESTRICT,
    CONSTRAINT fk_loyalty_redemption_transaction FOREIGN KEY (transaction_id) REFERENCES loyalty_transactions(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_wholesale_companies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL DEFAULT '',
    primary_contact_id INT NULL,
    company_name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(50) NULL,
    payment_terms VARCHAR(100) NULL,
    on_account_limit DECIMAL(10,2) NULL,
    status ENUM('active','inactive','archived') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wholesale_company_contact (business_id, primary_contact_id),
    INDEX idx_wholesale_company_status (business_id, status, company_name),
    CONSTRAINT fk_wholesale_company_contact FOREIGN KEY (primary_contact_id) REFERENCES ims_contacts(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_wholesale_company_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL DEFAULT '',
    company_id INT NOT NULL,
    location_name VARCHAR(255) NOT NULL,
    billing_address VARCHAR(255) NULL,
    billing_address2 VARCHAR(255) NULL,
    billing_suburb VARCHAR(100) NULL,
    billing_city VARCHAR(100) NULL,
    billing_state VARCHAR(100) NULL,
    billing_postcode VARCHAR(30) NULL,
    billing_country VARCHAR(100) NOT NULL DEFAULT 'Australia',
    shipping_address VARCHAR(255) NULL,
    shipping_address2 VARCHAR(255) NULL,
    shipping_suburb VARCHAR(100) NULL,
    shipping_city VARCHAR(100) NULL,
    shipping_state VARCHAR(100) NULL,
    shipping_postcode VARCHAR(30) NULL,
    shipping_country VARCHAR(100) NOT NULL DEFAULT 'Australia',
    is_primary TINYINT(1) NOT NULL DEFAULT 1,
    status ENUM('active','inactive','archived') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wholesale_company_location (business_id, company_id, location_name),
    INDEX idx_wholesale_location_primary (business_id, company_id, is_primary, status),
    CONSTRAINT fk_wholesale_location_company FOREIGN KEY (company_id) REFERENCES ims_wholesale_companies(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ims_wholesale_company_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(100) NOT NULL DEFAULT '',
    company_id INT NOT NULL,
    location_id INT NOT NULL,
    contact_id INT NOT NULL,
    role ENUM('owner','admin','buyer') NOT NULL DEFAULT 'buyer',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wholesale_company_member (business_id, company_id, contact_id),
    INDEX idx_wholesale_member_contact (business_id, contact_id, is_active),
    INDEX idx_wholesale_member_location (business_id, location_id, is_active),
    CONSTRAINT fk_wholesale_member_company FOREIGN KEY (company_id) REFERENCES ims_wholesale_companies(id) ON DELETE CASCADE,
    CONSTRAINT fk_wholesale_member_location FOREIGN KEY (location_id) REFERENCES ims_wholesale_company_locations(id) ON DELETE CASCADE,
    CONSTRAINT fk_wholesale_member_contact FOREIGN KEY (contact_id) REFERENCES ims_contacts(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ...ONLINE_SHOP_TABLE_DDLS,
];

// Column definitions: [table, column, definition]
const COLUMNS = [
  ['ims_online_shop_checkouts', 'fulfilment_mode', "VARCHAR(32) NOT NULL DEFAULT 'single_location' AFTER status"],
  ['ims_online_shop_value_reservations', 'reward_id', 'INT NULL AFTER value_type'],
  ['ims_online_shop_value_reservations', 'loyalty_redemption_id', 'BIGINT NULL AFTER reward_id'],
  ['ims_wholesale_team_events', 'details_json', 'JSON NULL AFTER after_role'],
  ['wholesale_draft_order_items', 'indent_qty', 'DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER is_indent'],
  ['ims_purchase_order_payments', 'business_id', "VARCHAR(100) NOT NULL DEFAULT '' AFTER id"],
  ['ims_purchase_order_payments', 'payment_method_id', 'INT NULL AFTER notes'],
  ['ims_purchase_order_payments', 'xero_post_intent', "ENUM('solvantis_only','post_to_xero') NOT NULL DEFAULT 'solvantis_only' AFTER payment_method_id"],
  ['ims_purchase_order_payments', 'xero_post_status', "ENUM('not_requested','pending','posted','failed','unknown') NOT NULL DEFAULT 'not_requested' AFTER xero_post_intent"],
  ['ims_purchase_order_payments', 'xero_payment_id', 'VARCHAR(100) NULL AFTER xero_post_status'],
  ['ims_purchase_order_payments', 'xero_post_error', 'VARCHAR(500) NULL AFTER xero_payment_id'],
  ['ims_purchase_order_payments', 'xero_posted_at', 'DATETIME NULL AFTER xero_post_error'],
  ['ims_sales_order_payments', 'business_id', "VARCHAR(100) NOT NULL DEFAULT '' AFTER id"],
  ['ims_sales_order_payments', 'payment_method_id', 'INT NULL AFTER notes'],
  ['ims_sales_order_payments', 'xero_post_intent', "ENUM('solvantis_only','post_to_xero') NOT NULL DEFAULT 'solvantis_only' AFTER payment_method_id"],
  ['ims_sales_order_payments', 'xero_post_status', "ENUM('not_requested','pending','posted','failed','unknown') NOT NULL DEFAULT 'not_requested' AFTER xero_post_intent"],
  ['ims_sales_order_payments', 'xero_payment_id', 'VARCHAR(100) NULL AFTER xero_post_status'],
  ['ims_sales_order_payments', 'xero_post_error', 'VARCHAR(500) NULL AFTER xero_payment_id'],
  ['ims_sales_order_payments', 'xero_posted_at', 'DATETIME NULL AFTER xero_post_error'],
  ['ims_so_fulfilment_operations', 'request_json', 'JSON NULL AFTER status'],
  ['ims_po_receive_operations', 'request_json', 'JSON NULL AFTER status'],
  ['ims_products', 'is_stock_item', 'TINYINT(1) NOT NULL DEFAULT 1'],
  ['ims_cs_learning_evidence', 'processed_at', 'DATETIME NULL'],
  ['ims_cs_threads', 'is_starred', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['ims_cs_threads', 'starred_at', 'DATETIME NULL'],
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
  ['ims_purchase_orders', 'replacement_of_po_id',      'INT NULL'],
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
  ['ims_sales_orders', 'wholesale_company_id', 'INT NULL AFTER customer_id'],
  ['ims_sales_orders', 'wholesale_location_id', 'INT NULL AFTER wholesale_company_id'],
  ['ims_sales_orders', 'wholesale_member_id', 'INT NULL AFTER wholesale_location_id'],
  ['ims_sales_orders', 'is_staff_preview_test', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER wholesale_member_id'],
  ['ims_sales_orders', 'staff_preview_session_id', 'VARCHAR(64) NULL AFTER is_staff_preview_test'],
  ['ims_sales_orders', 'staff_preview_actor_user_id', 'INT NULL AFTER staff_preview_session_id'],
  ['ims_sales_orders', 'staff_preview_actor_name', 'VARCHAR(255) NULL AFTER staff_preview_actor_user_id'],
  ['ims_sales_orders', 'sales_channel', "ENUM('shopify','native_shop') NULL AFTER so_type"],
  ['ims_sales_orders', 'native_checkout_id', 'CHAR(36) NULL AFTER sales_channel'],
  ['ims_sales_orders', 'xero_invoice_id',     'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'xero_invoice_number', 'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'xero_synced_at',      'DATETIME NULL'],
  ['ims_sales_orders', 'xero_sync_status',    "ENUM('synced','queued','error') NULL"],
  ['ims_sales_orders', 'shopify_order_name',  'VARCHAR(50) NULL'],
  ['ims_sales_orders', 'cin7_order_id',       'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'is_historical',       'TINYINT(1) NOT NULL DEFAULT 0'],
  ['ims_sales_orders', 'replacement_of_so_id', 'INT NULL'],
  ['ims_sales_orders', 'payment_terms',       'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'delivery_address',    'VARCHAR(255) NULL'],
  ['ims_sales_orders', 'delivery_address2',   'VARCHAR(255) NULL'],
  ['ims_sales_orders', 'delivery_suburb',     'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'delivery_city',       'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'delivery_state',      'VARCHAR(100) NULL'],
  ['ims_sales_orders', 'delivery_postcode',   'VARCHAR(30) NULL'],
  ['ims_sales_orders', 'delivery_country',    'VARCHAR(100) NULL'],
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
  ['ims_credit_notes', 'reversed_at',         'DATETIME NULL'],
  ['ims_credit_notes', 'reversal_reason',     'VARCHAR(500) NULL'],
  ['ims_credit_notes', 'reversed_by',         'INT NULL'],
  ['ims_credit_notes', 'xero_credit_note_id', 'VARCHAR(100) NULL'],
  ['ims_credit_notes', 'xero_synced_at',      'DATETIME NULL'],
  ['ims_credit_notes', 'xero_sync_status',    "ENUM('synced','queued','error') NULL"],
  ['ims_credit_notes', 'xero_correction_status', "ENUM('not_required','queued','synced','error','blocked') NULL"],
  ['ims_credit_notes', 'xero_correction_reference', 'VARCHAR(100) NULL'],
  ['ims_credit_notes', 'xero_correction_error', 'TEXT NULL'],
  ['ims_credit_notes', 'created_by',          'VARCHAR(150) NULL'],
  // ── ims_credit_note_items ────────────────────────────────────────────────
  ['ims_credit_note_items', 'price_basis',    "ENUM('cost','wholesale','rrp','custom') NOT NULL DEFAULT 'custom'"],
  ['ims_credit_note_items', 'restock',        'TINYINT(1) NOT NULL DEFAULT 1'],
  ['ims_credit_note_items', 'source_so_item_id', 'INT NULL AFTER restock'],
  // ── ims_supplier_credit_notes ────────────────────────────────────────────
  ['ims_supplier_credit_notes', 'supplier_credit_ref', 'VARCHAR(100) NULL'],
  ['ims_supplier_credit_notes', 'currency_code',       "VARCHAR(10) NOT NULL DEFAULT 'AUD'"],
  ['ims_supplier_credit_notes', 'exchange_rate',       'DECIMAL(12,6) NOT NULL DEFAULT 1.000000'],
  ['ims_supplier_credit_notes', 'xero_credit_note_id', 'VARCHAR(100) NULL'],
  ['ims_supplier_credit_notes', 'xero_synced_at',      'DATETIME NULL'],
  ['ims_supplier_credit_notes', 'xero_sync_status',    "ENUM('synced','queued','error') NULL"],
  ['ims_supplier_credit_notes', 'reversed_at',         'DATETIME NULL'],
  ['ims_supplier_credit_notes', 'reversal_reason',     'VARCHAR(500) NULL'],
  ['ims_supplier_credit_notes', 'reversed_by',         'INT NULL'],
  ['ims_supplier_credit_notes', 'xero_correction_status', "ENUM('not_required','queued','synced','error','blocked') NULL"],
  ['ims_supplier_credit_notes', 'xero_correction_reference', 'VARCHAR(100) NULL'],
  ['ims_supplier_credit_notes', 'xero_correction_error', 'TEXT NULL'],
  ['ims_supplier_credit_notes', 'created_by',          'VARCHAR(150) NULL'],
  // ── ims_supplier_credit_note_items ───────────────────────────────────────
  ['ims_supplier_credit_note_items', 'restock',        'TINYINT(1) NOT NULL DEFAULT 1'],
  ['ims_supplier_credit_note_items', 'source_po_item_id', 'INT NULL AFTER restock'],
  // ── ims_stocktakes / items ───────────────────────────────────────────────
  ['ims_stocktakes', 'reverted_at', 'DATETIME NULL'],
  ['ims_stocktakes', 'reversal_reason', 'VARCHAR(500) NULL'],
  ['ims_stocktakes', 'reversed_by', 'INT NULL'],
  ['ims_stocktakes', 'xero_reversal_journal_id', 'VARCHAR(100) NULL'],
  ['ims_stocktakes', 'xero_reversal_synced_at', 'DATETIME NULL'],
  ['ims_stocktakes', 'xero_reversal_sync_status', "ENUM('queued','synced','error','blocked','not_required') NULL"],
  ['ims_stocktakes', 'xero_reversal_error', 'TEXT NULL'],
  ['ims_stocktakes', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  ['ims_stocktake_items', 'soh_at_apply', 'DECIMAL(12,4) NULL'],
  ['ims_stocktake_items', 'applied_delta', 'DECIMAL(12,4) NULL'],
  ['ims_stocktake_items', 'unit_cost_at_apply', 'DECIMAL(15,4) NULL'],
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
  ['ims_contacts', 'loyalty_member', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['ims_contacts', 'loyalty_member_enrolled_at', 'DATETIME NULL'],
  ['ims_contacts', 'loyalty_member_opted_out_at', 'DATETIME NULL'],
  ['ims_contacts', 'wholesale_allowed_brands_json', 'JSON NULL'],
  ['wholesale_draft_orders', 'wholesale_company_id', 'INT NULL AFTER contact_id'],
  ['wholesale_draft_orders', 'wholesale_location_id', 'INT NULL AFTER wholesale_company_id'],
  ['wholesale_draft_orders', 'wholesale_member_id', 'INT NULL AFTER wholesale_location_id'],
  ['wholesale_draft_orders', 'is_staff_preview_test', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER wholesale_member_id'],
  ['wholesale_draft_orders', 'staff_preview_session_id', 'VARCHAR(64) NULL AFTER is_staff_preview_test'],
  ['wholesale_draft_orders', 'staff_preview_actor_user_id', 'INT NULL AFTER staff_preview_session_id'],
  ['wholesale_draft_orders', 'staff_preview_actor_name', 'VARCHAR(255) NULL AFTER staff_preview_actor_user_id'],
  // ── pos_sales / store_credit_transactions ───────────────────────────────
  ['pos_sales', 'customer_id',       'INT NULL'],
  ['pos_sales', 'credit_note_id',    'INT NULL'],
  ['pos_sales', 'loyalty_earn_rate', 'DECIMAL(12,4) NULL'],
  ['pos_sale_items', 'return_of_sale_item_id', 'INT NULL'],
  ['pos_sale_items', 'is_gift_card', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['pos_petty_cash_transactions', 'evidence_type', "ENUM('receipt','admin_attestation') NOT NULL DEFAULT 'receipt' AFTER reason"],
  ['pos_petty_cash_transactions', 'evidence_note', 'VARCHAR(500) NULL AFTER evidence_type'],
  ['store_credit_transactions', 'credit_note_id',   'INT NULL'],
  ['store_credit_transactions', 'idempotency_key',  'VARCHAR(191) NULL'],
  ['loyalty_transactions', 'eligible_spend_cents', 'INT UNSIGNED NULL'],
  ['ims_po_backorder_lines', 'source_item_snapshot', 'JSON NULL AFTER transferred_qty'],
  ['ims_so_backorder_lines', 'source_item_snapshot', 'JSON NULL AFTER transferred_qty'],
  ['ims_backorder_merges', 'request_hash', 'CHAR(64) NULL AFTER operation_key'],
  ['ims_backorder_merges', 'response_json', 'JSON NULL AFTER source_order_ids'],
  ['ims_backorder_merges', 'completed_at', 'DATETIME NULL AFTER created_at'],
  ['ims_po_shortfall_resolutions', 'accounting_action', "ENUM('none','resize_document','credit_note') NOT NULL DEFAULT 'none' AFTER currency_code"],
  ['ims_purchase_order_items', 'discount_pct', 'DECIMAL(8,4) NOT NULL DEFAULT 0 AFTER unit_cost'],
  ['ims_sales_order_items', 'shopify_line_item_id', 'VARCHAR(100) NULL AFTER so_id'],
];

const INDEXES = [
  ['ims_purchase_orders', 'idx_po_backorder_queue', 'INDEX `idx_po_backorder_queue` (`business_id`, `status`, `supplier_id`, `created_at`)'],
  ['ims_purchase_orders', 'uq_po_replacement_source', 'UNIQUE INDEX `uq_po_replacement_source` (`business_id`, `replacement_of_po_id`)'],
  ['ims_sales_orders', 'idx_so_backorder_queue', 'INDEX `idx_so_backorder_queue` (`business_id`, `status`, `customer_id`, `created_at`)'],
  ['ims_sales_orders', 'uq_so_replacement_source', 'UNIQUE INDEX `uq_so_replacement_source` (`business_id`, `replacement_of_so_id`)'],
  ['ims_sales_orders', 'idx_so_wholesale_account', 'INDEX `idx_so_wholesale_account` (`business_id`, `wholesale_company_id`, `wholesale_location_id`, `wholesale_member_id`)'],
  ['wholesale_draft_orders', 'idx_wholesale_draft_account', 'INDEX `idx_wholesale_draft_account` (`business_id`, `wholesale_company_id`, `wholesale_location_id`, `wholesale_member_id`)'],
  ['ims_sales_orders', 'idx_so_staff_preview', 'INDEX `idx_so_staff_preview` (`business_id`, `is_staff_preview_test`, `staff_preview_session_id`)'],
  ['ims_sales_orders', 'idx_so_online_channel', 'INDEX `idx_so_online_channel` (`business_id`, `sales_channel`, `order_date`, `id`)'],
  ['ims_sales_orders', 'uq_so_native_checkout', 'UNIQUE INDEX `uq_so_native_checkout` (`business_id`, `native_checkout_id`, `location_id`)'],
  ['wholesale_draft_orders', 'idx_wholesale_draft_preview', 'INDEX `idx_wholesale_draft_preview` (`business_id`, `is_staff_preview_test`, `staff_preview_session_id`)'],
  ['ims_cs_threads', 'idx_cs_thread_starred', 'INDEX `idx_cs_thread_starred` (`business_id`, `is_starred`, `last_message_at`)'],
  ['ims_contacts', 'idx_shopify_customer_id', 'UNIQUE INDEX `idx_shopify_customer_id` (`business_id`, `shopify_customer_id`)'],
  ['ims_credit_notes', 'idx_shopify_return', 'INDEX `idx_shopify_return` (`business_id`, `shopify_return_id`)'],
  ['ims_credit_notes', 'uq_cn_pos_sale', 'UNIQUE INDEX `uq_cn_pos_sale` (`business_id`, `pos_sale_id`)'],
  ['ims_credit_notes', 'uq_business_cn', 'UNIQUE INDEX `uq_business_cn` (`business_id`, `cn_number`)'],
  ['ims_credit_note_items', 'idx_cn_source_so_item', 'INDEX `idx_cn_source_so_item` (`source_so_item_id`)'],
  ['pos_sales', 'idx_ps_customer', 'INDEX `idx_ps_customer` (`customer_id`)'],
  ['pos_sales', 'uq_ps_credit_note', 'UNIQUE INDEX `uq_ps_credit_note` (`business_id`, `credit_note_id`)'],
  ['pos_sale_items', 'idx_psi_return_source', 'INDEX `idx_psi_return_source` (`return_of_sale_item_id`)'],
  ['store_credit_transactions', 'idx_sct_credit_note', 'INDEX `idx_sct_credit_note` (`credit_note_id`)'],
  ['store_credit_transactions', 'uq_sct_idempotency', 'UNIQUE INDEX `uq_sct_idempotency` (`idempotency_key`)'],
  ['ims_supplier_credit_notes', 'uq_business_scn', 'UNIQUE INDEX `uq_business_scn` (`business_id`, `scn_number`)'],
  ['ims_supplier_credit_note_items', 'idx_scn_source_po_item', 'INDEX `idx_scn_source_po_item` (`source_po_item_id`)'],
  ['ims_sales_order_items', 'idx_soitem_shopify_li', 'INDEX `idx_soitem_shopify_li` (`shopify_line_item_id`)'],
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

async function ensureSignedLoyaltyBalance(schema, table, column, definition) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`,
    [schema, table, column],
  );
  if (!String(rows[0]?.COLUMN_TYPE ?? '').toLowerCase().includes('unsigned')) return;
  await conn.query(
    `ALTER TABLE \`${schema}\`.\`${table}\` MODIFY COLUMN \`${column}\` ${definition}`,
  );
}

async function ensureColumnCollationMatches(schema, table, column, referenceTable, referenceColumn) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_SET_NAME, COLLATION_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND ((TABLE_NAME = ? AND COLUMN_NAME = ?) OR (TABLE_NAME = ? AND COLUMN_NAME = ?))`,
    [schema, table, column, referenceTable, referenceColumn],
  );
  const target = rows.find(row => row.TABLE_NAME === table);
  const reference = rows.find(row => row.TABLE_NAME === referenceTable);
  if (!target || !reference?.CHARACTER_SET_NAME || !reference.COLLATION_NAME) return;
  if (target.CHARACTER_SET_NAME === reference.CHARACTER_SET_NAME && target.COLLATION_NAME === reference.COLLATION_NAME) return;

  const nullSql = target.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
  const defaultSql = target.COLUMN_DEFAULT === null ? '' : ` DEFAULT ${conn.escape(target.COLUMN_DEFAULT)}`;
  await conn.query(
    `ALTER TABLE \`${schema}\`.\`${table}\` MODIFY COLUMN \`${column}\` ${target.COLUMN_TYPE}`
      + ` CHARACTER SET ${reference.CHARACTER_SET_NAME} COLLATE ${reference.COLLATION_NAME} ${nullSql}${defaultSql}`,
  );
}

async function ensureShopifyLineItemId(schema, table, nullable) {
  const [rows] = await conn.query(
    `SELECT c.COLUMN_TYPE, c.IS_NULLABLE, c.CHARACTER_SET_NAME, c.COLLATION_NAME,
            ref.CHARACTER_SET_NAME AS REF_CHARACTER_SET_NAME, ref.COLLATION_NAME AS REF_COLLATION_NAME
       FROM information_schema.COLUMNS c
       JOIN information_schema.COLUMNS ref
         ON ref.TABLE_SCHEMA = c.TABLE_SCHEMA
        AND ref.TABLE_NAME = 'ims_sales_order_items'
        AND ref.COLUMN_NAME = 'business_id'
      WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ? AND c.COLUMN_NAME = 'shopify_line_item_id'
      LIMIT 1`,
    [schema, table],
  );
  const column = rows[0];
  if (!column?.REF_CHARACTER_SET_NAME || !column.REF_COLLATION_NAME) return;
  const expectedType = 'varchar(100)';
  const alreadyNormalized = String(column.COLUMN_TYPE).toLowerCase() === expectedType
    && column.CHARACTER_SET_NAME === column.REF_CHARACTER_SET_NAME
    && column.COLLATION_NAME === column.REF_COLLATION_NAME
    && column.IS_NULLABLE === (nullable ? 'YES' : 'NO');
  if (alreadyNormalized) return;
  await conn.query(
    `ALTER TABLE \`${schema}\`.\`${table}\` MODIFY COLUMN shopify_line_item_id VARCHAR(100)`
      + ` CHARACTER SET ${column.REF_CHARACTER_SET_NAME} COLLATE ${column.REF_COLLATION_NAME}`
      + ` ${nullable ? 'NULL' : 'NOT NULL'}`,
  );
}

async function ensureForeignKey(schema, table, constraintName, column, referenceTable) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY' LIMIT 1`,
    [schema, table, constraintName],
  );
  if (rows.length) return;
  await conn.query(
    `ALTER TABLE \`${schema}\`.\`${table}\`
       ADD CONSTRAINT \`${constraintName}\` FOREIGN KEY (\`${column}\`)
       REFERENCES \`${referenceTable}\` (id) ON DELETE SET NULL`,
  );
}

async function ensureNativeCheckoutIndex(schema) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_sales_orders' AND INDEX_NAME = 'uq_so_native_checkout'
      ORDER BY SEQ_IN_INDEX`, [schema],
  );
  const columns = rows.map(row => row.COLUMN_NAME).join(',');
  if (columns === 'business_id,native_checkout_id,location_id') return;
  if (rows.length) await conn.query(`ALTER TABLE \`${schema}\`.ims_sales_orders DROP INDEX uq_so_native_checkout`);
  await conn.query(`ALTER TABLE \`${schema}\`.ims_sales_orders ADD UNIQUE INDEX uq_so_native_checkout (business_id, native_checkout_id, location_id)`);
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

  const [onlineShopTables] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
    [schema, ONLINE_SHOP_TABLES],
  );
  const presentOnlineShopTables = new Set(onlineShopTables.map(row => row.TABLE_NAME));
  const missingOnlineShopTables = ONLINE_SHOP_TABLES.filter(table => !presentOnlineShopTables.has(table));
  if (missingOnlineShopTables.length) {
    throw new Error(`${schema} is missing required online shop tables: ${missingOnlineShopTables.join(', ')}`);
  }

  for (const table of [
    'ims_wholesale_companies',
    'ims_wholesale_company_locations',
    'ims_wholesale_company_members',
    'ims_wholesale_member_locations',
    'ims_wholesale_saved_lists',
    'ims_wholesale_saved_list_items',
    'ims_wholesale_favourites',
    'ims_wholesale_team_events',
    'ims_so_shipments',
    'ims_so_shipment_items',
    'ims_so_shipment_tracking',
  ]) {
    await ensureColumnCollationMatches(
      schema,
      table,
      'business_id',
      table.startsWith('ims_so_shipment') ? 'ims_sales_orders' : 'ims_contacts',
      'business_id',
    );
  }
  await ensureShopifyLineItemId(schema, 'ims_sales_order_items', true);
  await ensureShopifyLineItemId(schema, 'ims_so_shipment_items', false);
  await ensureNativeCheckoutIndex(schema);

  try {
    await conn.query(
      `INSERT IGNORE INTO \`${schema}\`.ims_wholesale_member_locations
         (business_id, company_id, member_id, location_id)
       SELECT business_id, company_id, id, location_id
         FROM \`${schema}\`.ims_wholesale_company_members
        WHERE is_active = 1`,
    );
  } catch (e) {
    console.error(`  ✗ ${schema}.ims_wholesale_member_locations backfill: ${e.message}`);
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

  try {
    await conn.query(
      `UPDATE \`${schema}\`.ims_po_shortfall_resolutions
          SET accounting_action = CASE
            WHEN supplier_credit_note_id IS NOT NULL THEN 'credit_note'
            WHEN state IN ('xero_pending','failed','unknown') THEN 'resize_document'
            ELSE accounting_action
          END
        WHERE accounting_action = 'none'`,
    );
  } catch (e) {
    console.error(`  ✗ ${schema}.ims_po_shortfall_resolutions accounting backfill: ${e.message}`);
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
    await conn.query(
      `UPDATE \`${schema}\`.ims_sales_orders
          SET sales_channel = 'shopify'
        WHERE sales_channel IS NULL
          AND so_type = 'online'
          AND shopify_order_id IS NOT NULL
          AND shopify_order_id <> ''`,
    );
  } catch (e) {
    console.error(`  ✗ ${schema}.ims_sales_orders sales channel backfill: ${e.message}`);
  }

  try {
    await ensureColumnCollationMatches(schema, 'wholesale_draft_orders', 'business_id', 'ims_contacts', 'business_id');
    await ensureForeignKey(schema, 'wholesale_draft_orders', 'fk_wholesale_draft_company', 'wholesale_company_id', 'ims_wholesale_companies');
    await ensureForeignKey(schema, 'wholesale_draft_orders', 'fk_wholesale_draft_location', 'wholesale_location_id', 'ims_wholesale_company_locations');
    await ensureForeignKey(schema, 'wholesale_draft_orders', 'fk_wholesale_draft_member', 'wholesale_member_id', 'ims_wholesale_company_members');
    await ensureForeignKey(schema, 'ims_sales_orders', 'fk_so_wholesale_company', 'wholesale_company_id', 'ims_wholesale_companies');
    await ensureForeignKey(schema, 'ims_sales_orders', 'fk_so_wholesale_location', 'wholesale_location_id', 'ims_wholesale_company_locations');
    await ensureForeignKey(schema, 'ims_sales_orders', 'fk_so_wholesale_member', 'wholesale_member_id', 'ims_wholesale_company_members');
    await conn.query(
      `UPDATE \`${schema}\`.wholesale_draft_orders d
         JOIN \`${schema}\`.ims_wholesale_company_members m
           ON m.business_id = d.business_id AND m.contact_id = d.contact_id AND m.is_active = 1
         JOIN \`${schema}\`.ims_wholesale_companies c
           ON c.id = m.company_id AND c.business_id = m.business_id AND c.status = 'active'
         JOIN \`${schema}\`.ims_wholesale_company_locations l
           ON l.id = m.location_id AND l.company_id = c.id AND l.business_id = m.business_id AND l.status = 'active'
          SET d.wholesale_company_id = c.id,
              d.wholesale_location_id = l.id,
              d.wholesale_member_id = m.id
        WHERE d.status = 'draft'
          AND (d.wholesale_company_id IS NULL OR d.wholesale_location_id IS NULL OR d.wholesale_member_id IS NULL)`,
    );
    await ensureEnumValues(schema, 'ims_purchase_orders', 'status', ['draft', 'confirmed', 'partially_received', 'backordered', 'complete', 'cancelled']);
    await ensureEnumValues(schema, 'ims_sales_orders', 'status', ['draft', 'confirmed', 'partially_fulfilled', 'backordered', 'fulfilled', 'cancelled']);
    await ensureEnumValues(schema, 'loyalty_transactions', 'channel', ['pos', 'shopify', 'native_shop', 'manual', 'migration']);
    await ensureEnumValues(schema, 'ims_credit_notes', 'status', ['draft', 'awaiting_product', 'complete', 'cancelled', 'reversed']);
    await ensureEnumValues(schema, 'ims_supplier_credit_notes', 'status', ['draft', 'complete', 'cancelled', 'reversed']);
    await ensureEnumValues(schema, 'ims_credit_notes', 'source', ['manual', 'shopify', 'pos', 'so_shortfall']);
    await ensureEnumValues(schema, 'ims_credit_notes', 'tax_treatment', ['ex_tax', 'inc_tax', 'no_tax']);
    await ensureEnumValues(schema, 'ims_stock_movements', 'movement_type', ['cn_returned', 'scn_returned', 'cn_return_reversed', 'scn_return_reversed', 'stocktake_reverted']);
    await ensureEnumValues(schema, 'ims_stock_movements', 'reference_type', ['credit_note', 'supplier_credit_note']);
    await ensureSignedLoyaltyBalance(schema, 'loyalty_accounts', 'balance_points', 'INT NOT NULL DEFAULT 0');
    await ensureSignedLoyaltyBalance(schema, 'loyalty_transactions', 'balance_after', 'INT NOT NULL');
    await ensureColumnCollationMatches(schema, 'ims_po_shortfall_resolutions', 'business_id', 'ims_purchase_orders', 'business_id');
    await ensureColumnCollationMatches(schema, 'ims_supplier_credit_settlements', 'business_id', 'ims_purchase_orders', 'business_id');
    await ensureColumnCollationMatches(schema, 'ims_so_shortfall_resolutions', 'business_id', 'ims_sales_orders', 'business_id');
    await ensureColumnCollationMatches(schema, 'ims_customer_credit_settlements', 'business_id', 'ims_sales_orders', 'business_id');
    await ensureColumnCollationMatches(schema, 'ims_website_content_attempts', 'business_id', 'ims_products', 'business_id');
    await ensureColumnCollationMatches(schema, 'ims_website_content_attempts', 'product_id', 'ims_products', 'product_id');
    await ensureColumnCollationMatches(schema, 'ims_crm_interactions', 'business_id', 'ims_contacts', 'business_id');
    await ensureColumnCollationMatches(schema, 'ims_crm_tasks', 'business_id', 'ims_contacts', 'business_id');
    await ensureColumnCollationMatches(schema, 'ims_crm_tags', 'business_id', 'ims_contacts', 'business_id');
    await ensureColumnCollationMatches(schema, 'ims_crm_contact_tags', 'business_id', 'ims_contacts', 'business_id');
    await ensureColumnCollationMatches(schema, 'ims_crm_segments', 'business_id', 'ims_contacts', 'business_id');
    await ensureColumnCollationMatches(schema, 'ims_crm_pipeline_stages', 'business_id', 'ims_contacts', 'business_id');
    await ensureColumnCollationMatches(schema, 'ims_crm_opportunities', 'business_id', 'ims_contacts', 'business_id');
    await ensureColumnCollationMatches(schema, 'ims_crm_contact_merges', 'business_id', 'ims_contacts', 'business_id');
  } catch (e) {
    console.error(`  ✗ ${schema} schema catch-up: ${e.message}`);
  }

  console.log(`✓ ${schema}: added ${added} columns, skipped ${skipped}, added ${indexesAdded} indexes, skipped ${indexesSkipped}`);
}

async function verifyBackorderMergeSchema(schema) {
  const [rows] = await conn.query(
    `SELECT INDEX_NAME
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_backorder_merges'`,
    [schema],
  );
  const indexes = new Set(rows.map(row => row.INDEX_NAME));
  for (const required of ['PRIMARY', 'uq_backorder_merge_operation', 'idx_backorder_merge_target']) {
    if (!indexes.has(required)) throw new Error(`${schema}.ims_backorder_merges is missing ${required}`);
  }
  console.log(`  verified ${schema}.ims_backorder_merges`);
}

async function verifyStockAvailabilitySchema(schema) {
  const requiredColumns = {
    ims_stock_allocations: ['business_id', 'so_item_id', 'po_item_id', 'qty_allocated', 'qty_received_assigned', 'promise_status', 'state', 'revision'],
    ims_stock_allocation_operations: ['business_id', 'operation_key', 'request_hash', 'action', 'state'],
    wholesale_draft_order_items: ['is_indent', 'indent_qty'],
  };
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const [rows] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [schema, table],
    );
    const found = new Set(rows.map(row => row.COLUMN_NAME));
    for (const column of columns) if (!found.has(column)) throw new Error(`${schema}.${table} is missing ${column}`);
  }
  console.log(`  verified ${schema} stock availability schema`);
}

async function verifyOutstandingResolutionSchema(schema) {
  const required = {
    ims_so_shortfall_resolutions: ['PRIMARY', 'uq_so_shortfall_operation', 'idx_so_shortfall_source', 'idx_so_shortfall_child'],
    ims_customer_credit_settlements: ['PRIMARY', 'uq_customer_credit_action', 'idx_customer_credit_resolution', 'idx_customer_credit_target'],
    ims_po_shortfall_resolutions: ['PRIMARY', 'uq_po_shortfall_operation', 'idx_po_shortfall_source', 'idx_po_shortfall_child'],
    ims_supplier_credit_settlements: ['PRIMARY', 'uq_supplier_credit_action', 'idx_supplier_credit_resolution', 'idx_supplier_credit_target'],
  };
  for (const [table, indexes] of Object.entries(required)) {
    const [rows] = await conn.query(`SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`, [schema, table]);
    const found = new Set(rows.map(row => row.INDEX_NAME));
    for (const index of indexes) if (!found.has(index)) throw new Error(`${schema}.${table} is missing ${index}`);
  }
  const [sourceRows] = await conn.query(`SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='ims_credit_notes' AND COLUMN_NAME='source'`, [schema]);
  if (!String(sourceRows[0]?.COLUMN_TYPE ?? '').includes("'so_shortfall'")) throw new Error(`${schema}.ims_credit_notes.source is missing so_shortfall`);
  const [taxTreatmentRows] = await conn.query(`SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='ims_credit_notes' AND COLUMN_NAME='tax_treatment'`, [schema]);
  if (!String(taxTreatmentRows[0]?.COLUMN_TYPE ?? '').includes("'no_tax'")) throw new Error(`${schema}.ims_credit_notes.tax_treatment is missing no_tax`);
  for (const [table, referenceTable] of [
    ['ims_po_shortfall_resolutions', 'ims_purchase_orders'],
    ['ims_supplier_credit_settlements', 'ims_purchase_orders'],
    ['ims_so_shortfall_resolutions', 'ims_sales_orders'],
    ['ims_customer_credit_settlements', 'ims_sales_orders'],
  ]) {
    const [collationRows] = await conn.query(
      `SELECT TABLE_NAME, COLLATION_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=? AND COLUMN_NAME='business_id' AND TABLE_NAME IN (?, ?)`,
      [schema, table, referenceTable],
    );
    const collations = new Map(collationRows.map(row => [row.TABLE_NAME, row.COLLATION_NAME]));
    if (!collations.get(table) || collations.get(table) !== collations.get(referenceTable)) {
      throw new Error(`${schema}.${table}.business_id collation does not match ${referenceTable}`);
    }
  }
  console.log(`  verified ${schema} outstanding-resolution schema`);
}

async function verifyInventoryDocumentOperationSchema(schema) {
  const requiredColumns = [
    'business_id', 'operation_key', 'request_hash', 'document_kind', 'document_id', 'action',
    'previous_status', 'resulting_status', 'state', 'before_metadata_json', 'after_metadata_json',
    'response_json', 'actor_id', 'actor_name', 'created_at', 'completed_at',
  ];
  const [columnRows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_inventory_document_operations'`,
    [schema],
  );
  const columns = new Set(columnRows.map(row => row.COLUMN_NAME));
  for (const column of requiredColumns) {
    if (!columns.has(column)) throw new Error(`${schema}.ims_inventory_document_operations is missing ${column}`);
  }

  const [indexRows] = await conn.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_inventory_document_operations'`,
    [schema],
  );
  const indexes = new Set(indexRows.map(row => row.INDEX_NAME));
  for (const index of ['PRIMARY', 'uq_inventory_document_operation', 'idx_inventory_document_history']) {
    if (!indexes.has(index)) throw new Error(`${schema}.ims_inventory_document_operations is missing ${index}`);
  }
  console.log(`  verified ${schema}.ims_inventory_document_operations`);
}

async function verifyInventoryDocumentCorrectionSchema(schema) {
  const requiredColumns = {
    ims_credit_notes: ['reversed_at', 'reversal_reason', 'reversed_by', 'xero_correction_status', 'xero_correction_reference', 'xero_correction_error'],
    ims_supplier_credit_notes: ['reversed_at', 'reversal_reason', 'reversed_by', 'xero_correction_status', 'xero_correction_reference', 'xero_correction_error'],
    ims_stocktakes: ['reverted_at', 'reversal_reason', 'reversed_by', 'xero_reversal_journal_id', 'xero_reversal_synced_at', 'xero_reversal_sync_status', 'xero_reversal_error', 'updated_at'],
    ims_stocktake_items: ['soh_at_apply', 'applied_delta', 'unit_cost_at_apply'],
  };
  const [columnRows] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('ims_credit_notes','ims_supplier_credit_notes','ims_stocktakes','ims_stocktake_items','ims_stock_movements')`,
    [schema],
  );
  const columnsByTable = new Map();
  for (const row of columnRows) {
    if (!columnsByTable.has(row.TABLE_NAME)) columnsByTable.set(row.TABLE_NAME, new Map());
    columnsByTable.get(row.TABLE_NAME).set(row.COLUMN_NAME, row.COLUMN_TYPE);
  }
  for (const [table, columns] of Object.entries(requiredColumns)) {
    for (const column of columns) {
      if (!columnsByTable.get(table)?.has(column)) throw new Error(`${schema}.${table} is missing ${column}`);
    }
  }
  const requiredEnumValues = {
    'ims_credit_notes.status': ['cancelled', 'reversed'],
    'ims_supplier_credit_notes.status': ['cancelled', 'reversed'],
    'ims_stocktakes.status': ['cancelled', 'reverted'],
    'ims_stock_movements.movement_type': ['cn_return_reversed', 'scn_return_reversed', 'stocktake_reverted'],
  };
  for (const [qualifiedColumn, values] of Object.entries(requiredEnumValues)) {
    const [table, column] = qualifiedColumn.split('.');
    const columnType = String(columnsByTable.get(table)?.get(column) ?? '');
    for (const value of values) {
      if (!columnType.includes(`'${value}'`)) throw new Error(`${schema}.${qualifiedColumn} is missing enum value ${value}`);
    }
  }
  console.log(`  verified ${schema} inventory-document correction schema`);
}

async function verifyOrderPaymentSchema(schema) {
  const requiredColumns = [
    'business_id', 'payment_method_id', 'xero_post_intent', 'xero_post_status',
    'xero_payment_id', 'xero_post_error', 'xero_posted_at',
  ];
  for (const table of ['ims_purchase_order_payments', 'ims_sales_order_payments']) {
    const [rows] = await conn.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
      [schema, table],
    );
    const columns = new Map(rows.map(row => [row.COLUMN_NAME, String(row.COLUMN_TYPE ?? '')]));
    for (const column of requiredColumns) {
      if (!columns.has(column)) throw new Error(`${schema}.${table} is missing ${column}`);
    }
    for (const value of ['solvantis_only', 'post_to_xero']) {
      if (!columns.get('xero_post_intent')?.includes(`'${value}'`)) throw new Error(`${schema}.${table}.xero_post_intent is missing ${value}`);
    }
    for (const value of ['not_requested', 'pending', 'posted', 'failed', 'unknown']) {
      if (!columns.get('xero_post_status')?.includes(`'${value}'`)) throw new Error(`${schema}.${table}.xero_post_status is missing ${value}`);
    }
    console.log(`  verified ${schema}.${table}`);
  }
}

async function verifySalesDocumentSchema(schema) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE, IS_NULLABLE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'ims_sales_orders'
        AND COLUMN_NAME = 'xero_invoice_number'`,
    [schema],
  );
  const column = rows[0];
  if (!column) throw new Error(`${schema}.ims_sales_orders is missing xero_invoice_number`);
  if (String(column.COLUMN_TYPE).toLowerCase() !== 'varchar(100)' || column.IS_NULLABLE !== 'YES') {
    throw new Error(`${schema}.ims_sales_orders.xero_invoice_number must be nullable VARCHAR(100)`);
  }
  console.log(`  verified ${schema}.ims_sales_orders.xero_invoice_number`);
}

async function verifyWholesaleAccessSchema(schema) {
  const [rows] = await conn.query(
    `SELECT DATA_TYPE, IS_NULLABLE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ims_contacts'
        AND COLUMN_NAME = 'wholesale_allowed_brands_json'`,
    [schema],
  );
  const column = rows[0];
  if (!column) throw new Error(`${schema}.ims_contacts is missing wholesale_allowed_brands_json`);
  if (String(column.DATA_TYPE).toLowerCase() !== 'json' || column.IS_NULLABLE !== 'YES') {
    throw new Error(`${schema}.ims_contacts.wholesale_allowed_brands_json must be nullable JSON`);
  }
  console.log(`  verified ${schema}.ims_contacts.wholesale_allowed_brands_json`);
}

async function verifyWholesaleOrderOwnershipSchema(schema) {
  for (const table of ['wholesale_draft_orders', 'ims_sales_orders']) {
    const [columnRows] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [schema, table],
    );
    const columns = new Set(columnRows.map(row => row.COLUMN_NAME));
    for (const column of ['wholesale_company_id', 'wholesale_location_id', 'wholesale_member_id']) {
      if (!columns.has(column)) throw new Error(`${schema}.${table} is missing ${column}`);
    }
  }
  const [constraintRows] = await conn.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'
        AND TABLE_NAME IN ('wholesale_draft_orders', 'ims_sales_orders')`,
    [schema],
  );
  const constraints = new Set(constraintRows.map(row => row.CONSTRAINT_NAME));
  for (const constraint of [
    'fk_wholesale_draft_company', 'fk_wholesale_draft_location', 'fk_wholesale_draft_member',
    'fk_so_wholesale_company', 'fk_so_wholesale_location', 'fk_so_wholesale_member',
  ]) {
    if (!constraints.has(constraint)) throw new Error(`${schema} is missing ${constraint}`);
  }
  console.log(`  verified ${schema} wholesale order ownership schema`);
}

async function verifyWholesalePreviewTestSchema(schema) {
  const expectedColumns = new Map([
    ['is_staff_preview_test', { type: 'tinyint(1)', nullable: 'NO', defaultValue: '0' }],
    ['staff_preview_session_id', { type: 'varchar(64)', nullable: 'YES', defaultValue: null }],
    ['staff_preview_actor_user_id', { type: 'int', nullable: 'YES', defaultValue: null }],
    ['staff_preview_actor_name', { type: 'varchar(255)', nullable: 'YES', defaultValue: null }],
  ]);
  for (const [table, indexName] of [
    ['wholesale_draft_orders', 'idx_wholesale_draft_preview'],
    ['ims_sales_orders', 'idx_so_staff_preview'],
  ]) {
    const [columnRows] = await conn.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          AND COLUMN_NAME IN ('is_staff_preview_test', 'staff_preview_session_id', 'staff_preview_actor_user_id', 'staff_preview_actor_name')`,
      [schema, table],
    );
    const columns = new Map(columnRows.map(row => [row.COLUMN_NAME, row]));
    for (const [columnName, expected] of expectedColumns) {
      const column = columns.get(columnName);
      if (!column) throw new Error(`${schema}.${table} is missing ${columnName}`);
      if (String(column.COLUMN_TYPE).toLowerCase() !== expected.type
        || column.IS_NULLABLE !== expected.nullable
        || String(column.COLUMN_DEFAULT) !== String(expected.defaultValue)) {
        throw new Error(`${schema}.${table}.${columnName} has an invalid type, nullability, or default`);
      }
    }
    const [indexRows] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
        ORDER BY SEQ_IN_INDEX`,
      [schema, table, indexName],
    );
    const indexColumns = indexRows.map(row => row.COLUMN_NAME).join(',');
    if (indexColumns !== 'business_id,is_staff_preview_test,staff_preview_session_id') {
      throw new Error(`${schema}.${table} is missing the expected ${indexName} index`);
    }
  }
  console.log(`  verified ${schema} wholesale preview test schema`);
}

async function verifyWholesaleSavedListsSchema(schema) {
  const requiredTables = [
    'ims_wholesale_member_locations',
    'ims_wholesale_saved_lists',
    'ims_wholesale_saved_list_items',
    'ims_wholesale_favourites',
    'ims_wholesale_team_events',
  ];
  const [rows] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
    [schema, requiredTables],
  );
  const tables = new Set(rows.map(row => row.TABLE_NAME));
  for (const table of requiredTables) {
    if (!tables.has(table)) throw new Error(`${schema} is missing ${table}`);
  }
  const [missingGrantRows] = await conn.query(
    `SELECT wm.id FROM \`${schema}\`.ims_wholesale_company_members wm
      LEFT JOIN \`${schema}\`.ims_wholesale_member_locations ml
        ON ml.business_id = wm.business_id AND ml.company_id = wm.company_id
       AND ml.member_id = wm.id AND ml.location_id = wm.location_id
     WHERE wm.is_active = 1 AND ml.id IS NULL LIMIT 1`,
  );
  if (missingGrantRows.length) throw new Error(`${schema} has an active wholesale member without its default location grant`);
  console.log(`  verified ${schema} wholesale locations, saved lists, favourites, and team audit schema`);
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
  const requestedSchema = process.argv.find(argument => argument.startsWith('--schema='))?.slice('--schema='.length);
  if (requestedSchema && !schemas.has(requestedSchema)) {
    throw new Error(`Requested schema is not registered: ${requestedSchema}`);
  }
  const selectedSchemas = requestedSchema ? [requestedSchema] : [...schemas];
  console.log(`Schemas: ${selectedSchemas.join(', ')}`);
  for (const schema of selectedSchemas) {
    await migrateSchema(schema);
    await verifyBackorderMergeSchema(schema);
    await verifyStockAvailabilitySchema(schema);
    await verifyOutstandingResolutionSchema(schema);
    await verifyInventoryDocumentOperationSchema(schema);
    await verifyInventoryDocumentCorrectionSchema(schema);
    await verifyOrderPaymentSchema(schema);
    await verifySalesDocumentSchema(schema);
    await verifyWholesaleAccessSchema(schema);
    await verifyWholesaleOrderOwnershipSchema(schema);
    await verifyWholesalePreviewTestSchema(schema);
    await verifyWholesaleSavedListsSchema(schema);
  }
  console.log('Done.');
} finally {
  await conn.end();
}
