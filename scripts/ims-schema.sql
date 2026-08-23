-- ============================================================
-- Marketoir IMS Schema
-- Target: MariaDB / MySQL (utf8mb4)
-- Run this inside the designated IMS database
-- ============================================================

SET NAMES utf8mb4;

-- ── Contacts (Suppliers + Customers + Leads) ────────────────
CREATE TABLE IF NOT EXISTS ims_contacts (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL DEFAULT '',
  type        ENUM('supplier','b2b_customer','retail_customer','lead','both') NOT NULL DEFAULT 'supplier',
  -- Name fields
  name        VARCHAR(255) NOT NULL,
  first_name  VARCHAR(100) DEFAULT NULL,
  last_name   VARCHAR(100) DEFAULT NULL,
  company     VARCHAR(255),
  customer_code VARCHAR(100) DEFAULT NULL,
  customer_group VARCHAR(100) DEFAULT NULL,
  shopify_customer_id VARCHAR(100) DEFAULT NULL,
  -- Contact
  email       VARCHAR(255),
  phone       VARCHAR(50),
  password_hash VARCHAR(255) NULL,
  mobile      VARCHAR(50) DEFAULT NULL,
  -- Address
  address     TEXT,
  address2    VARCHAR(255) DEFAULT NULL,
  suburb      VARCHAR(100) DEFAULT NULL,
  city        VARCHAR(100),
  state       VARCHAR(100),
  postcode    VARCHAR(20),
  country     VARCHAR(100) DEFAULT 'Australia',
  -- Customer-specific
  store_credit      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  on_account_limit  DECIMAL(10,2) DEFAULT NULL,
  date_of_birth     DATE DEFAULT NULL,
  gender            VARCHAR(10) DEFAULT NULL,
  promo_email       TINYINT(1) NOT NULL DEFAULT 0,
  promo_sms         TINYINT(1) NOT NULL DEFAULT 0,
  loyalty_member              TINYINT(1) NOT NULL DEFAULT 0,
  loyalty_member_enrolled_at  DATETIME DEFAULT NULL,
  loyalty_member_opted_out_at DATETIME DEFAULT NULL,
  -- Supplier-specific
  lead_time_days      INT DEFAULT NULL,
  order_frequency_days INT NOT NULL DEFAULT 45,
  charges_tax         TINYINT(1) NOT NULL DEFAULT 1,
  prices_include_tax  TINYINT(1) NOT NULL DEFAULT 0,
  tax_rate            DECIMAL(6,4) DEFAULT NULL,
  website_url         VARCHAR(500) DEFAULT NULL,
  price_tier          VARCHAR(20) DEFAULT 'retail',
  wholesale_allowed_brands_json JSON DEFAULT NULL,
  -- Misc
  notes       TEXT,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  cin7_supplier_id  INT DEFAULT NULL,
  cin7_customer_id  INT DEFAULT NULL,
  cin7_contact_id   INT DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business_id (business_id),
  UNIQUE KEY idx_shopify_customer_id (business_id, shopify_customer_id),
  INDEX idx_customer_code (business_id, customer_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Wholesale company accounts ─────────────────────────────
CREATE TABLE IF NOT EXISTS ims_wholesale_companies (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_wholesale_company_locations (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_wholesale_company_members (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_wholesale_member_locations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL DEFAULT '',
  company_id INT NOT NULL,
  member_id INT NOT NULL,
  location_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wholesale_member_location (business_id, member_id, location_id),
  INDEX idx_wholesale_location_members (business_id, company_id, location_id, member_id),
  CONSTRAINT fk_wholesale_member_location_member FOREIGN KEY (member_id) REFERENCES ims_wholesale_company_members(id) ON DELETE CASCADE,
  CONSTRAINT fk_wholesale_member_location_location FOREIGN KEY (location_id) REFERENCES ims_wholesale_company_locations(id) ON DELETE CASCADE,
  CONSTRAINT fk_wholesale_member_location_company FOREIGN KEY (company_id) REFERENCES ims_wholesale_companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_wholesale_saved_lists (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL DEFAULT '',
  company_id INT NOT NULL,
  created_by_member_id INT NOT NULL,
  name VARCHAR(80) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wholesale_saved_list_name (business_id, company_id, name),
  INDEX idx_wholesale_saved_list_company (business_id, company_id, updated_at, id),
  CONSTRAINT fk_wholesale_saved_list_company FOREIGN KEY (company_id) REFERENCES ims_wholesale_companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_wholesale_saved_list_member FOREIGN KEY (created_by_member_id) REFERENCES ims_wholesale_company_members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_wholesale_saved_list_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL DEFAULT '',
  list_id BIGINT NOT NULL,
  variant_id VARCHAR(64) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wholesale_saved_list_variant (business_id, list_id, variant_id),
  INDEX idx_wholesale_saved_list_items (business_id, list_id, id),
  CONSTRAINT fk_wholesale_saved_list_item_list FOREIGN KEY (list_id) REFERENCES ims_wholesale_saved_lists(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_wholesale_favourites (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL DEFAULT '',
  company_id INT NOT NULL,
  member_id INT NOT NULL,
  variant_id VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wholesale_favourite_variant (business_id, company_id, member_id, variant_id),
  INDEX idx_wholesale_favourites_member (business_id, company_id, member_id, created_at),
  CONSTRAINT fk_wholesale_favourite_company FOREIGN KEY (company_id) REFERENCES ims_wholesale_companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_wholesale_favourite_member FOREIGN KEY (member_id) REFERENCES ims_wholesale_company_members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_wholesale_team_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL DEFAULT '',
  company_id INT NOT NULL,
  actor_member_id INT NULL,
  actor_name VARCHAR(255) NOT NULL,
  target_member_id INT NULL,
  target_contact_id INT NULL,
  target_name VARCHAR(255) NOT NULL,
  target_email VARCHAR(320) NOT NULL,
  action VARCHAR(32) NOT NULL,
  before_role VARCHAR(16) NULL,
  after_role VARCHAR(16) NULL,
  details_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wholesale_team_events (business_id, company_id, created_at, id),
  CONSTRAINT fk_wholesale_team_event_company FOREIGN KEY (company_id) REFERENCES ims_wholesale_companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_wholesale_team_event_actor FOREIGN KEY (actor_member_id) REFERENCES ims_wholesale_company_members(id) ON DELETE SET NULL,
  CONSTRAINT fk_wholesale_team_event_member FOREIGN KEY (target_member_id) REFERENCES ims_wholesale_company_members(id) ON DELETE SET NULL,
  CONSTRAINT fk_wholesale_team_event_contact FOREIGN KEY (target_contact_id) REFERENCES ims_contacts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── CRM (customer interactions, follow-ups and tags) ───────
CREATE TABLE IF NOT EXISTS ims_crm_interactions (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id   VARCHAR(100) NOT NULL,
  contact_id    INT NOT NULL,
  interaction_type VARCHAR(32) NOT NULL DEFAULT 'note',
  body          MEDIUMTEXT NOT NULL,
  occurred_at   DATETIME NULL,
  actor_id      INT NULL,
  actor_name    VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_crm_interaction_timeline (business_id, contact_id, occurred_at, id),
  CONSTRAINT fk_crm_interaction_contact FOREIGN KEY (contact_id)
    REFERENCES ims_contacts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_crm_tasks (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id   VARCHAR(100) NOT NULL,
  contact_id    INT NOT NULL,
  title         VARCHAR(255) NOT NULL,
  description   TEXT NULL,
  due_date      DATE NULL,
  priority      VARCHAR(16) NOT NULL DEFAULT 'normal',
  status        VARCHAR(16) NOT NULL DEFAULT 'open',
  assigned_user_id INT NULL,
  assigned_user_name VARCHAR(255) NULL,
  created_by    INT NULL,
  created_by_name VARCHAR(255) NULL,
  completed_by  INT NULL,
  completed_by_name VARCHAR(255) NULL,
  completed_at  DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_crm_task_contact (business_id, contact_id, status, due_date, id),
  INDEX idx_crm_task_assignee (business_id, assigned_user_id, status, due_date),
  CONSTRAINT fk_crm_task_contact FOREIGN KEY (contact_id)
    REFERENCES ims_contacts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_crm_tags (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  business_id   VARCHAR(100) NOT NULL,
  name          VARCHAR(100) NOT NULL,
  normalized_name VARCHAR(100) NOT NULL,
  color         VARCHAR(32) NULL,
  created_by    INT NULL,
  created_by_name VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crm_tag_name (business_id, normalized_name),
  INDEX idx_crm_tag_lookup (business_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_crm_contact_tags (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id   VARCHAR(100) NOT NULL,
  contact_id    INT NOT NULL,
  tag_id        INT NOT NULL,
  created_by    INT NULL,
  created_by_name VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crm_contact_tag (business_id, contact_id, tag_id),
  INDEX idx_crm_contact_tag_lookup (business_id, tag_id, contact_id),
  CONSTRAINT fk_crm_contact_tag_contact FOREIGN KEY (contact_id)
    REFERENCES ims_contacts(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_contact_tag_tag FOREIGN KEY (tag_id)
    REFERENCES ims_crm_tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_crm_segments (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  business_id   VARCHAR(100) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  normalized_name VARCHAR(120) NOT NULL,
  description   VARCHAR(500) NULL,
  rules_json    JSON NOT NULL,
  created_by    INT NULL,
  created_by_name VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crm_segment_name (business_id, normalized_name),
  INDEX idx_crm_segment_lookup (business_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_crm_pipeline_stages (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  business_id   VARCHAR(100) NOT NULL,
  name          VARCHAR(80) NOT NULL,
  normalized_name VARCHAR(80) NOT NULL,
  position      INT NOT NULL DEFAULT 0,
  category      VARCHAR(16) NOT NULL DEFAULT 'open',
  default_probability INT NOT NULL DEFAULT 0,
  color         VARCHAR(32) NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crm_pipeline_stage_name (business_id, normalized_name),
  INDEX idx_crm_pipeline_stage_order (business_id, is_active, position, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_crm_opportunities (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id   VARCHAR(100) NOT NULL,
  contact_id    INT NOT NULL,
  stage_id      INT NOT NULL,
  title         VARCHAR(255) NOT NULL,
  description   TEXT NULL,
  expected_value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  probability   INT NOT NULL DEFAULT 0,
  owner_user_id INT NULL,
  owner_name    VARCHAR(255) NULL,
  next_action_date DATE NULL,
  lost_reason   VARCHAR(500) NULL,
  created_by    INT NULL,
  created_by_name VARCHAR(255) NULL,
  closed_at     DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_crm_opportunity_stage (business_id, stage_id, next_action_date, id),
  INDEX idx_crm_opportunity_contact (business_id, contact_id, id),
  INDEX idx_crm_opportunity_owner (business_id, owner_user_id, stage_id),
  CONSTRAINT fk_crm_opportunity_contact FOREIGN KEY (contact_id)
    REFERENCES ims_contacts(id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_opportunity_stage FOREIGN KEY (stage_id)
    REFERENCES ims_crm_pipeline_stages(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_crm_contact_merges (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id         VARCHAR(100) NOT NULL,
  source_contact_id   INT NOT NULL,
  target_contact_id   INT NOT NULL,
  source_snapshot_json JSON NOT NULL,
  target_snapshot_json JSON NOT NULL,
  merged_by           INT NULL,
  merged_by_name      VARCHAR(255) NULL,
  merged_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_crm_contact_merge_source (business_id, source_contact_id, merged_at),
  INDEX idx_crm_contact_merge_target (business_id, target_contact_id, merged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Locations (Branches / Warehouses) ───────────────────────
CREATE TABLE IF NOT EXISTS ims_locations (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL DEFAULT '',
  name        VARCHAR(255) NOT NULL,
  code        VARCHAR(50),
  phone       VARCHAR(50) NULL,
  address     TEXT,
  city        VARCHAR(100),
  state       VARCHAR(100),
  postcode    VARCHAR(20),
  country     VARCHAR(100) DEFAULT 'Australia',
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  pos_location_code VARCHAR(32) NULL,
  pos_pin     VARCHAR(20) NULL,
  manager_pin_hash VARCHAR(255) NULL,
  cin7_branch_id INT NULL,
  has_pos     TINYINT(1) NOT NULL DEFAULT 0,
  has_wholesale TINYINT(1) NOT NULL DEFAULT 0,
  has_online  TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY idx_pos_location_code (pos_location_code),
  INDEX idx_business_id (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pos_chat_messages (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  location_id    INT NOT NULL,
  location_name  VARCHAR(255) NOT NULL DEFAULT '',
  user_name      VARCHAR(255) NOT NULL DEFAULT '',
  avatar         VARCHAR(100) NOT NULL DEFAULT '',
  message        TEXT NOT NULL,
  to_location_id INT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pos_chat_created (created_at),
  INDEX idx_pos_chat_dm (location_id, to_location_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pos_chat_attachments (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  message_id    INT NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  file_size     INT UNSIGNED NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pos_chat_attachment_message (message_id),
  CONSTRAINT fk_pos_chat_attachment_message FOREIGN KEY (message_id)
    REFERENCES pos_chat_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Settings (per-business IMS configuration) ───────────────
CREATE TABLE IF NOT EXISTS ims_settings (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL DEFAULT '',
  `key`       VARCHAR(120) NOT NULL,
  value       MEDIUMTEXT,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ims_settings_business_key (business_id, `key`),
  INDEX idx_business_id (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Customer Service Inbox settings and durable Gmail cache
CREATE TABLE IF NOT EXISTS ims_cs_settings (
  business_id          VARCHAR(100) NOT NULL PRIMARY KEY,
  enabled              TINYINT(1) NOT NULL DEFAULT 0,
  timezone_override    VARCHAR(100) NULL,
  run_times_json       TEXT NOT NULL,
  automation_mode      ENUM('draft','send') NOT NULL DEFAULT 'draft',
  lookback_days        INT NOT NULL DEFAULT 7,
  retention_days       INT NOT NULL DEFAULT 90,
  light_model_id       VARCHAR(150) NOT NULL DEFAULT 'gemini-2.5-flash',
  capable_model_id     VARCHAR(150) NOT NULL DEFAULT 'gemini-2.5-pro',
  enabled_tools_json   TEXT NOT NULL,
  guidelines           MEDIUMTEXT NULL,
  helper_emails_json   TEXT NOT NULL,
  learning_enabled     TINYINT(1) NOT NULL DEFAULT 1,
  gmail_history_id     VARCHAR(100) NULL,
  last_run_at          DATETIME NULL,
  next_run_at          DATETIME NULL,
  last_error           TEXT NULL,
  lock_owner           VARCHAR(150) NULL,
  lock_claimed_at      DATETIME NULL,
  legacy_imported_at   DATETIME NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_cs_threads (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  gmail_thread_id      VARCHAR(255) NOT NULL,
  latest_message_id    VARCHAR(255) NULL,
  customer_id          INT NULL,
  customer_email       VARCHAR(255) NULL,
  subject              VARCHAR(500) NOT NULL DEFAULT '',
  snippet              VARCHAR(1000) NULL,
  participants_json    TEXT NOT NULL,
  gmail_labels_json    TEXT NOT NULL,
  message_count        INT NOT NULL DEFAULT 0,
  unread_count         INT NOT NULL DEFAULT 0,
  category             ENUM('customer_enquiry','junk','other') NULL,
  enquiry_subtype      VARCHAR(50) NULL,
  classification_confidence DECIMAL(5,4) NULL,
  classification_reason VARCHAR(1000) NULL,
  urgency              ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  sentiment            ENUM('negative','neutral','positive') NOT NULL DEFAULT 'neutral',
  workflow_status      ENUM('open','needs_review','drafted','sent','archived','failed') NOT NULL DEFAULT 'open',
  is_starred           TINYINT(1) NOT NULL DEFAULT 0,
  starred_at           DATETIME NULL,
  assigned_user_id     INT NULL,
  classifier_model_id  VARCHAR(150) NULL,
  classifier_version   VARCHAR(50) NULL,
  classified_at        DATETIME NULL,
  last_message_at      DATETIME NOT NULL,
  last_gmail_sync_at   DATETIME NOT NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cs_thread_gmail (business_id, gmail_thread_id),
  INDEX idx_cs_thread_list (business_id, last_message_at),
  INDEX idx_cs_thread_category (business_id, category, workflow_status),
  INDEX idx_cs_thread_starred (business_id, is_starred, last_message_at),
  INDEX idx_cs_thread_customer (business_id, customer_email),
  INDEX idx_cs_thread_unread (business_id, unread_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_cs_messages (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  thread_id            BIGINT NOT NULL,
  gmail_message_id     VARCHAR(255) NOT NULL,
  gmail_thread_id      VARCHAR(255) NOT NULL,
  direction            ENUM('inbound','outbound','draft') NOT NULL,
  from_address         VARCHAR(500) NOT NULL DEFAULT '',
  to_json              TEXT NOT NULL,
  cc_json              TEXT NOT NULL,
  subject              VARCHAR(500) NOT NULL DEFAULT '',
  message_id_header    VARCHAR(1000) NULL,
  references_header    TEXT NULL,
  body_plain           MEDIUMTEXT NULL,
  body_html            MEDIUMTEXT NULL,
  attachment_metadata_json MEDIUMTEXT NOT NULL,
  gmail_labels_json    TEXT NOT NULL,
  is_read              TINYINT(1) NOT NULL DEFAULT 1,
  is_draft             TINYINT(1) NOT NULL DEFAULT 0,
  is_sent              TINYINT(1) NOT NULL DEFAULT 0,
  message_at           DATETIME NOT NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cs_message_gmail (business_id, gmail_message_id),
  INDEX idx_cs_message_thread (business_id, thread_id, message_at),
  INDEX idx_cs_message_date (business_id, message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_cs_drafts (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  thread_id            BIGINT NOT NULL,
  target_message_id    BIGINT NOT NULL,
  operation_key        VARCHAR(191) NOT NULL,
  version              INT NOT NULL DEFAULT 1,
  status               ENUM('generated','editing','gmail_draft','sending','sent','failed','superseded') NOT NULL DEFAULT 'generated',
  subject              VARCHAR(500) NOT NULL DEFAULT '',
  ai_generated_body    MEDIUMTEXT NOT NULL,
  current_body         MEDIUMTEXT NOT NULL,
  gmail_draft_id       VARCHAR(255) NULL,
  gmail_sent_message_id VARCHAR(255) NULL,
  model_id             VARCHAR(150) NOT NULL,
  prompt_version       VARCHAR(50) NOT NULL,
  confidence           DECIMAL(5,4) NULL,
  needs_information    TINYINT(1) NOT NULL DEFAULT 0,
  escalation_reason    VARCHAR(1000) NULL,
  tool_provenance_json MEDIUMTEXT NOT NULL,
  editor_user_id       INT NULL,
  edited_at            DATETIME NULL,
  sent_at              DATETIME NULL,
  last_error           TEXT NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cs_draft_operation (business_id, operation_key),
  INDEX idx_cs_draft_thread (business_id, thread_id, status),
  INDEX idx_cs_draft_target (business_id, target_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_cs_draft_revisions (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  draft_id             BIGINT NOT NULL,
  version              INT NOT NULL,
  body                 MEDIUMTEXT NOT NULL,
  change_source        ENUM('ai','user','send') NOT NULL,
  user_id              INT NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cs_draft_revision (business_id, draft_id, version),
  INDEX idx_cs_revision_draft (business_id, draft_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_cs_processing_runs (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  run_type             ENUM('sync','classify','generate','send','cleanup','learn') NOT NULL,
  trigger_type         ENUM('manual','schedule','system') NOT NULL,
  status               ENUM('running','success','partial','error') NOT NULL,
  counts_json          TEXT NOT NULL,
  error_message        TEXT NULL,
  started_at           DATETIME NOT NULL,
  completed_at         DATETIME NULL,
  duration_ms          INT NULL,
  INDEX idx_cs_run_business (business_id, started_at),
  INDEX idx_cs_run_status (business_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_cs_events (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  thread_id            BIGINT NULL,
  draft_id             BIGINT NULL,
  event_type           VARCHAR(80) NOT NULL,
  actor_type           ENUM('user','ai','gmail','system') NOT NULL,
  actor_id             VARCHAR(150) NULL,
  details_json         MEDIUMTEXT NOT NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cs_event_thread (business_id, thread_id, created_at),
  INDEX idx_cs_event_type (business_id, event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_cs_learning_evidence (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  draft_id             BIGINT NULL,
  evidence_type        ENUM('draft_edit','rating','classification_correction','manual_finding','rejection') NOT NULL,
  sanitized_summary    TEXT NOT NULL,
  evidence_hash        CHAR(64) NOT NULL,
  is_factual           TINYINT(1) NOT NULL DEFAULT 0,
  expires_at           DATETIME NULL,
  processed_at         DATETIME NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cs_evidence_hash (business_id, evidence_hash),
  INDEX idx_cs_evidence_type (business_id, evidence_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_cs_learning_candidates (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  rule_key             VARCHAR(191) NOT NULL,
  rule_type            ENUM('style','fact','policy') NOT NULL,
  title                VARCHAR(255) NOT NULL,
  proposed_markdown    TEXT NOT NULL,
  status               ENUM('pending','active','rejected','superseded') NOT NULL DEFAULT 'pending',
  evidence_count       INT NOT NULL DEFAULT 1,
  confidence           DECIMAL(5,4) NOT NULL DEFAULT 0,
  auto_activated       TINYINT(1) NOT NULL DEFAULT 0,
  reviewed_by          INT NULL,
  reviewed_at          DATETIME NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cs_learning_rule (business_id, rule_key),
  INDEX idx_cs_learning_status (business_id, status, rule_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_cs_knowledge_documents (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  document_key         ENUM('style','knowledge') NOT NULL,
  filename             VARCHAR(100) NOT NULL,
  markdown_content     MEDIUMTEXT NOT NULL,
  version              INT NOT NULL DEFAULT 1,
  content_hash         CHAR(64) NOT NULL,
  updated_by           INT NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cs_document (business_id, document_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_cs_knowledge_versions (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  document_key         ENUM('style','knowledge') NOT NULL,
  version              INT NOT NULL,
  markdown_content     MEDIUMTEXT NOT NULL,
  content_hash         CHAR(64) NOT NULL,
  change_reason        VARCHAR(500) NULL,
  created_by           INT NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cs_document_version (business_id, document_key, version),
  INDEX idx_cs_document_history (business_id, document_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Products ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ims_products (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL DEFAULT '',
  product_id            VARCHAR(36) NOT NULL UNIQUE,
  name                  VARCHAR(255) NOT NULL,
  description           MEDIUMTEXT,
  product_type          VARCHAR(100),
  category              VARCHAR(255),
  subcategory           VARCHAR(255),
  brand                 VARCHAR(255),
  tags                  VARCHAR(1000),
  website_title         VARCHAR(255),
  style_code            VARCHAR(100),
  base_sku              VARCHAR(100),
  is_online             TINYINT(1) NOT NULL DEFAULT 0,
  supplier_contact_id   INT NULL,
  cin7_product_id       VARCHAR(100),
  pack_size             INT NULL,
  zone                  VARCHAR(100),
  bin                   VARCHAR(100),
  allow_indent_wholesale TINYINT(1) NOT NULL DEFAULT 0,
  is_stock_item         TINYINT(1) NOT NULL DEFAULT 1,
  is_active             TINYINT(1) NOT NULL DEFAULT 1,
  shopify_product_id    VARCHAR(100),
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business_id (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Product Variants ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ims_product_variants (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  business_id         VARCHAR(100) NOT NULL DEFAULT '',
  variant_id          VARCHAR(36) NOT NULL UNIQUE,
  product_id          VARCHAR(36) NOT NULL,
  sku                 VARCHAR(100),
  barcode             VARCHAR(100),
  option1_name        VARCHAR(100),
  option1_value       VARCHAR(100),
  option2_name        VARCHAR(100),
  option2_value       VARCHAR(100),
  option3_name        VARCHAR(100),
  option3_value       VARCHAR(100),
  cost                DECIMAL(12,4),
  cost_aud            DECIMAL(12,4) NULL,
  avg_cost            DECIMAL(15,4) NULL,
  cost_foreign        TEXT NULL,
  price               DECIMAL(12,4),
  price_rrp           DECIMAL(12,2) NULL,
  price_wholesale     DECIMAL(10,4) NULL,
  price_rrp_sale      DECIMAL(12,2) NULL,
  discounted_price    DECIMAL(12,4),
  discount_start_date DATE,
  discount_end_date   DATE,
  pack_size           INT NULL,
  cin7_option_id      INT NULL,
  bin                 VARCHAR(100) NULL,
  zone                VARCHAR(100) NULL,
  volume              TINYINT UNSIGNED NULL,
  weight_kg           DECIMAL(8,4),
  shopify_variant_id  VARCHAR(100),
  shopify_inventory_item_id VARCHAR(100) NULL,
  is_active           TINYINT(1) NOT NULL DEFAULT 1,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES ims_products(product_id) ON DELETE CASCADE,
  INDEX idx_business_id (business_id),
  INDEX idx_pv_product (product_id),
  INDEX idx_pv_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Product Images ───────────────────────────────────────────
-- Up to 8 images per product; one marked is_primary (used by POS/website).
-- updated_at enables incremental "since" sync from the POS product cache.
CREATE TABLE IF NOT EXISTS ims_product_images (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Website Content Attempts ────────────────────────────────
CREATE TABLE IF NOT EXISTS ims_website_content_attempts (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id         VARCHAR(100) NOT NULL,
  product_id          VARCHAR(36) NOT NULL,
  outcome             VARCHAR(32) NOT NULL,
  workflow            VARCHAR(32) NOT NULL DEFAULT 'pending_online_bulk',
  candidate_urls_json MEDIUMTEXT NOT NULL,
  decisions_json      MEDIUMTEXT NOT NULL,
  attempted_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_website_attempt_product (business_id, product_id, outcome, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Stock Levels ─────────────────────────────────────────────
-- qty_on_hand   = physical stock at location
-- qty_incoming  = on approved POs (not yet received)
-- qty_committed = on confirmed SOs (not yet fulfilled)
-- avg_cost      = weighted average cost per unit
CREATE TABLE IF NOT EXISTS ims_stock (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  business_id   VARCHAR(100) NOT NULL DEFAULT '',
  variant_id    VARCHAR(36) NOT NULL,
  location_id   INT NOT NULL,
  qty_on_hand   DECIMAL(12,4) NOT NULL DEFAULT 0,
  qty_incoming  DECIMAL(12,4) NOT NULL DEFAULT 0,
  qty_committed DECIMAL(12,4) NOT NULL DEFAULT 0,
  min_qty       DECIMAL(12,4) NOT NULL DEFAULT 0,
  reorder_qty   DECIMAL(12,4) NOT NULL DEFAULT 0,
  avg_cost      DECIMAL(12,4),
  zone          VARCHAR(50) NULL,
  bin           VARCHAR(50) NULL,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stock (variant_id, location_id),
  INDEX idx_business_id (business_id),
  FOREIGN KEY (variant_id) REFERENCES ims_product_variants(variant_id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES ims_locations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Purchase Orders ──────────────────────────────────────────
-- draft     → approved (adds qty_incoming)
-- approved  → received (moves to qty_on_hand, recalcs avg_cost)
-- approved  → draft    (reverses qty_incoming)
-- any       → cancelled
CREATE TABLE IF NOT EXISTS ims_purchase_orders (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  business_id   VARCHAR(100) NOT NULL DEFAULT '',
  po_number     VARCHAR(50) NOT NULL UNIQUE,
  supplier_id   INT,
  location_id   INT NOT NULL,
  status        ENUM('draft','confirmed','partially_received','backordered','complete','cancelled') NOT NULL DEFAULT 'draft',
  order_date    DATE NOT NULL,
  expected_date DATE,
  received_date DATE,
  notes         TEXT,
  supplier_invoice_number VARCHAR(100),
  supplier_invoice_date DATE,
  payment_terms VARCHAR(100),
  xero_bill_id VARCHAR(100) NULL,
  xero_synced_at DATETIME NULL,
  xero_sync_status ENUM('synced','queued','error') NULL,
  cin7_order_id VARCHAR(50) NULL,
  is_historical TINYINT(1) NOT NULL DEFAULT 0,
  replacement_of_po_id INT NULL,
  currency_code VARCHAR(10) NOT NULL DEFAULT 'AUD',
  exchange_rate DECIMAL(12,6) NOT NULL DEFAULT 1.000000,
  cin7_contact_id INT NULL,
  tax_treatment ENUM('ex_tax','inc_tax','no_tax') NOT NULL DEFAULT 'ex_tax',
  tax_code VARCHAR(50) NULL,
  supplier_name_raw VARCHAR(255) NULL,
  subtotal      DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  freight       DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business_id (business_id),
  INDEX idx_po_backorder_queue (business_id, status, supplier_id, created_at),
  UNIQUE INDEX uq_po_replacement_source (business_id, replacement_of_po_id),
  FOREIGN KEY (supplier_id) REFERENCES ims_contacts(id) ON DELETE SET NULL,
  FOREIGN KEY (location_id) REFERENCES ims_locations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Purchase Order Landed Costs ───────────────────────────────
-- Separate-invoice import costs (customs, duties, etc).
-- NOT included in total_amount (invoice total) but ARE distributed
-- proportionally to variant avg_cost when the PO is received.
CREATE TABLE IF NOT EXISTS ims_po_landed_costs (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL DEFAULT '',
  po_id      INT NOT NULL,
  label      VARCHAR(200) NOT NULL,
  reference  VARCHAR(200),
  amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (po_id) REFERENCES ims_purchase_orders(id) ON DELETE CASCADE,
  INDEX idx_business_id (business_id),
  INDEX idx_polc_po (po_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Purchase Order Items ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS ims_purchase_order_items (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  business_id  VARCHAR(100) NOT NULL DEFAULT '',
  po_id        INT NOT NULL,
  variant_id   VARCHAR(36) NOT NULL,
  qty_ordered  DECIMAL(12,4) NOT NULL,
  qty_received DECIMAL(12,4) NOT NULL DEFAULT 0,
  unit_cost    DECIMAL(12,4) NOT NULL,
  discount_pct DECIMAL(8,4) NOT NULL DEFAULT 0,
  tax_rate     DECIMAL(6,4) NOT NULL DEFAULT 0,
  line_total   DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes        VARCHAR(500),
  FOREIGN KEY (po_id) REFERENCES ims_purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES ims_product_variants(variant_id),
  INDEX idx_business_id (business_id),
  INDEX idx_poi_po (po_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_purchase_order_payments (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  business_id      VARCHAR(100) NOT NULL DEFAULT '',
  po_id             INT NOT NULL,
  payment_date      DATE NOT NULL,
  amount            DECIMAL(12,4) NOT NULL,
  currency_code     VARCHAR(10) NOT NULL DEFAULT 'AUD',
  exchange_rate     DECIMAL(12,6) NOT NULL DEFAULT 1.000000,
  amount_local      DECIMAL(12,4) NOT NULL,
  notes             VARCHAR(500),
  payment_method_id INT NULL,
  xero_post_intent  ENUM('solvantis_only','post_to_xero') NOT NULL DEFAULT 'solvantis_only',
  xero_post_status  ENUM('not_requested','pending','posted','failed','unknown') NOT NULL DEFAULT 'not_requested',
  xero_payment_id   VARCHAR(100) NULL,
  xero_post_error   VARCHAR(500) NULL,
  xero_posted_at    DATETIME NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (po_id) REFERENCES ims_purchase_orders(id) ON DELETE CASCADE,
  INDEX idx_pop_po (po_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Sales Orders ─────────────────────────────────────────────
-- draft     → confirmed  (adds qty_committed)
-- confirmed → partially_fulfilled → fulfilled (deducts shipped qty from on-hand + committed)
-- confirmed → draft      (reverses qty_committed)
-- any       → cancelled
CREATE TABLE IF NOT EXISTS ims_sales_orders (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  business_id      VARCHAR(100) NOT NULL DEFAULT '',
  so_number        VARCHAR(50) NOT NULL UNIQUE,
  customer_id      INT,
  wholesale_company_id INT NULL,
  wholesale_location_id INT NULL,
  wholesale_member_id INT NULL,
  is_staff_preview_test TINYINT(1) NOT NULL DEFAULT 0,
  staff_preview_session_id VARCHAR(64) NULL,
  staff_preview_actor_user_id INT NULL,
  staff_preview_actor_name VARCHAR(255) NULL,
  customer_po_number VARCHAR(100) NULL,
  price_tier       ENUM('retail','wholesale') NOT NULL DEFAULT 'retail',
  so_type          VARCHAR(10) NOT NULL DEFAULT 'b2b',
  sales_channel    ENUM('shopify','native_shop') NULL,
  native_checkout_id CHAR(36) NULL,
  location_id      INT NOT NULL,
  status           ENUM('draft','confirmed','partially_fulfilled','backordered','fulfilled','cancelled') NOT NULL DEFAULT 'draft',
  order_date       DATE NOT NULL,
  expected_date    DATE,
  fulfilled_date   DATE,
  delivery_address VARCHAR(255) NULL,
  delivery_address2 VARCHAR(255) NULL,
  delivery_suburb  VARCHAR(100) NULL,
  delivery_city    VARCHAR(100) NULL,
  delivery_state   VARCHAR(100) NULL,
  delivery_postcode VARCHAR(30) NULL,
  delivery_country VARCHAR(100) NULL,
  payment_terms    VARCHAR(100) NULL,
  notes            TEXT,
  tax_treatment    ENUM('ex_tax','inc_tax','no_tax') NOT NULL DEFAULT 'ex_tax',
  freight          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discount         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  subtotal         DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency_code    VARCHAR(10) NOT NULL DEFAULT 'AUD',
  exchange_rate    DECIMAL(12,6) NOT NULL DEFAULT 1.000000,
  xero_invoice_id  VARCHAR(100) NULL,
  xero_invoice_number VARCHAR(100) NULL,
  xero_synced_at   DATETIME NULL,
  xero_sync_status ENUM('synced','queued','error') NULL,
  shopify_order_name VARCHAR(50) NULL,
  shopify_order_id VARCHAR(100),
  cin7_order_id    VARCHAR(100) NULL,
  is_historical   TINYINT(1) NOT NULL DEFAULT 0,
  replacement_of_so_id INT NULL,
  cin7_member_id  INT NULL,
  tax_code         VARCHAR(50) NULL,
  payment_gateway  VARCHAR(255) NULL,
  refunded_amount  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  financial_status VARCHAR(50) NULL,
  returned_at      DATETIME NULL,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business_id (business_id),
  INDEX idx_so_wholesale_account (business_id, wholesale_company_id, wholesale_location_id, wholesale_member_id),
  INDEX idx_so_staff_preview (business_id, is_staff_preview_test, staff_preview_session_id),
  INDEX idx_so_online_channel (business_id, sales_channel, order_date, id),
  UNIQUE INDEX uq_so_native_checkout (business_id, native_checkout_id, location_id),
  INDEX idx_so_backorder_queue (business_id, status, customer_id, created_at),
  UNIQUE INDEX uq_so_replacement_source (business_id, replacement_of_so_id),
  FOREIGN KEY (customer_id) REFERENCES ims_contacts(id) ON DELETE SET NULL,
  FOREIGN KEY (location_id) REFERENCES ims_locations(id),
  CONSTRAINT fk_so_wholesale_company FOREIGN KEY (wholesale_company_id) REFERENCES ims_wholesale_companies(id) ON DELETE SET NULL,
  CONSTRAINT fk_so_wholesale_location FOREIGN KEY (wholesale_location_id) REFERENCES ims_wholesale_company_locations(id) ON DELETE SET NULL,
  CONSTRAINT fk_so_wholesale_member FOREIGN KEY (wholesale_member_id) REFERENCES ims_wholesale_company_members(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Sales Order Items ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ims_sales_order_items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  business_id   VARCHAR(100) NOT NULL DEFAULT '',
  so_id         INT NOT NULL,
  shopify_line_item_id BIGINT NULL,
  variant_id    VARCHAR(36) NOT NULL,
  qty_ordered   DECIMAL(12,4) NOT NULL,
  qty_fulfilled DECIMAL(12,4) NOT NULL DEFAULT 0,
  unit_price    DECIMAL(12,4) NOT NULL,
  unit_cost     DECIMAL(12,4),
  discount_pct  DECIMAL(6,4) NOT NULL DEFAULT 0,
  tax_rate      DECIMAL(6,4) NOT NULL DEFAULT 0,
  line_total    DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes         VARCHAR(500),
  FOREIGN KEY (so_id) REFERENCES ims_sales_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES ims_product_variants(variant_id),
  INDEX idx_business_id (business_id),
  INDEX idx_soi_so (so_id),
  INDEX idx_soitem_shopify_li (shopify_line_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_sales_order_payments (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  business_id      VARCHAR(100) NOT NULL DEFAULT '',
  so_id             INT NOT NULL,
  payment_date      DATE NOT NULL,
  amount            DECIMAL(12,4) NOT NULL,
  currency_code     VARCHAR(10) NOT NULL DEFAULT 'AUD',
  exchange_rate     DECIMAL(12,6) NOT NULL DEFAULT 1.000000,
  amount_local      DECIMAL(12,4) NOT NULL,
  notes             VARCHAR(500),
  payment_method_id INT NULL,
  xero_post_intent  ENUM('solvantis_only','post_to_xero') NOT NULL DEFAULT 'solvantis_only',
  xero_post_status  ENUM('not_requested','pending','posted','failed','unknown') NOT NULL DEFAULT 'not_requested',
  xero_payment_id   VARCHAR(100) NULL,
  xero_post_error   VARCHAR(500) NULL,
  xero_posted_at    DATETIME NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (so_id) REFERENCES ims_sales_orders(id) ON DELETE CASCADE,
  INDEX idx_sop_so (so_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_so_fulfilment_operations (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id    VARCHAR(100) NOT NULL,
  operation_key  VARCHAR(191) NOT NULL,
  request_hash   CHAR(64) NOT NULL,
  so_id          INT NOT NULL,
  status         ENUM('processing','complete') NOT NULL DEFAULT 'processing',
  request_json   JSON NULL,
  response_json  JSON NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at   DATETIME NULL,
  UNIQUE KEY uq_so_fulfilment_operation (business_id, operation_key),
  INDEX idx_so_fulfilment_order (business_id, so_id, created_at),
  FOREIGN KEY (so_id) REFERENCES ims_sales_orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_so_shipments (
  id                       BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id              VARCHAR(100) NOT NULL,
  so_id                    INT NOT NULL,
  shopify_fulfilment_id    VARCHAR(100) NOT NULL,
  status                   VARCHAR(100) NULL,
  fulfilled_at             DATETIME NULL,
  shopify_updated_at       DATETIME NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_so_shipment_shopify (business_id, shopify_fulfilment_id),
  INDEX idx_so_shipment_order (business_id, so_id, fulfilled_at, id),
  FOREIGN KEY (so_id) REFERENCES ims_sales_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS ims_so_shipment_items (
  id                       BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id              VARCHAR(100) NOT NULL,
  shipment_id              BIGINT NOT NULL,
  shopify_line_item_id     VARCHAR(100) NOT NULL,
  quantity                 DECIMAL(12,4) NOT NULL,
  INDEX idx_so_shipment_item (business_id, shipment_id, id),
  FOREIGN KEY (shipment_id) REFERENCES ims_so_shipments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS ims_so_shipment_tracking (
  id                       BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id              VARCHAR(100) NOT NULL,
  shipment_id              BIGINT NOT NULL,
  company                  VARCHAR(255) NULL,
  tracking_number          VARCHAR(255) NULL,
  tracking_url             VARCHAR(2000) NULL,
  INDEX idx_so_shipment_tracking (business_id, shipment_id, id),
  FOREIGN KEY (shipment_id) REFERENCES ims_so_shipments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS ims_po_receive_operations (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id    VARCHAR(100) NOT NULL,
  operation_key  VARCHAR(191) NOT NULL,
  request_hash   CHAR(64) NOT NULL,
  po_id          INT NOT NULL,
  status         ENUM('processing','complete') NOT NULL DEFAULT 'processing',
  request_json   JSON NULL,
  response_json  JSON NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at   DATETIME NULL,
  UNIQUE KEY uq_po_receive_operation (business_id, operation_key),
  INDEX idx_po_receive_order (business_id, po_id, created_at),
  FOREIGN KEY (po_id) REFERENCES ims_purchase_orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_stock_allocations (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  so_id                 INT NOT NULL,
  so_item_id            INT NOT NULL,
  po_id                 INT NOT NULL,
  po_item_id             INT NOT NULL,
  variant_id            VARCHAR(36) NOT NULL,
  location_id           INT NOT NULL,
  qty_allocated         DECIMAL(12,4) NOT NULL,
  qty_received_assigned DECIMAL(12,4) NOT NULL DEFAULT 0,
  qty_fulfilled         DECIMAL(12,4) NOT NULL DEFAULT 0,
  source_expected_date  DATE NULL,
  promised_date         DATE NULL,
  promise_status        ENUM('unpromised','confirmed','at_risk') NOT NULL DEFAULT 'unpromised',
  state                 ENUM('active','fulfilled','released','cancelled') NOT NULL DEFAULT 'active',
  priority              INT NOT NULL DEFAULT 0,
  override_reason       VARCHAR(500) NULL,
  risk_reason           VARCHAR(500) NULL,
  created_by            INT NULL,
  created_by_name       VARCHAR(255) NULL,
  released_by           INT NULL,
  released_by_name      VARCHAR(255) NULL,
  released_reason       VARCHAR(500) NULL,
  revision              INT NOT NULL DEFAULT 1,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  released_at           DATETIME NULL,
  INDEX idx_stock_allocation_so (business_id, so_id, so_item_id, state),
  INDEX idx_stock_allocation_po (business_id, po_id, po_item_id, state),
  INDEX idx_stock_allocation_supply (business_id, variant_id, location_id, state, priority),
  INDEX idx_stock_allocation_promise (business_id, promise_status, promised_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_stock_allocation_operations (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id    VARCHAR(100) NOT NULL,
  operation_key  VARCHAR(191) NOT NULL,
  request_hash   CHAR(64) NOT NULL,
  action         ENUM('allocate','resize','release','reassign','revise_promise','merge_retarget') NOT NULL,
  allocation_id  BIGINT NULL,
  state          ENUM('processing','complete') NOT NULL DEFAULT 'processing',
  request_json   JSON NULL,
  response_json  JSON NULL,
  actor_id       INT NULL,
  actor_name     VARCHAR(255) NULL,
  safe_error     VARCHAR(500) NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at   DATETIME NULL,
  UNIQUE KEY uq_stock_allocation_operation (business_id, operation_key),
  INDEX idx_stock_allocation_history (business_id, allocation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_order_amendment_operations (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id       VARCHAR(100) NOT NULL,
  operation_key     VARCHAR(191) NOT NULL,
  request_hash      CHAR(64) NOT NULL,
  order_kind        VARCHAR(32) NOT NULL,
  order_id          INT NOT NULL,
  order_status      VARCHAR(32) NOT NULL,
  state             VARCHAR(32) NOT NULL DEFAULT 'processing',
  before_header_json JSON NULL,
  after_header_json  JSON NULL,
  actor_id          INT NULL,
  actor_name        VARCHAR(255) NULL,
  safe_error        VARCHAR(500) NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at      DATETIME NULL,
  UNIQUE KEY uq_order_amendment_operation (business_id, operation_key),
  INDEX idx_order_amendment_order (business_id, order_kind, order_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_inventory_document_operations (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id         VARCHAR(100) NOT NULL,
  operation_key       VARCHAR(191) NOT NULL,
  request_hash        CHAR(64) NOT NULL,
  document_kind       ENUM('customer_credit_note','supplier_credit_note','stocktake') NOT NULL,
  document_id         INT NOT NULL,
  action              VARCHAR(64) NOT NULL,
  previous_status     VARCHAR(32) NOT NULL,
  resulting_status    VARCHAR(32) NULL,
  state               ENUM('processing','complete') NOT NULL DEFAULT 'processing',
  before_metadata_json JSON NULL,
  after_metadata_json  JSON NULL,
  response_json       JSON NULL,
  actor_id            INT NULL,
  actor_name          VARCHAR(255) NULL,
  safe_error          VARCHAR(500) NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at        DATETIME NULL,
  UNIQUE KEY uq_inventory_document_operation (business_id, operation_key),
  INDEX idx_inventory_document_history (business_id, document_kind, document_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_order_amendment_lines (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  amendment_id         BIGINT NOT NULL,
  source_line_id       INT NULL,
  result_line_id       INT NULL,
  moved_quantity_floor DECIMAL(12,4) NOT NULL DEFAULT 0,
  before_line_json     JSON NULL,
  after_line_json      JSON NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_amendment_lines (business_id, amendment_id, id),
  CONSTRAINT fk_order_amendment_lines_operation FOREIGN KEY (amendment_id) REFERENCES ims_order_amendment_operations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_so_shortfall_resolutions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  operation_key VARCHAR(191) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  source_so_id INT NOT NULL,
  outcome ENUM('leave_partial','cancel_remainder','create_backorder') NOT NULL,
  settlement ENUM('none','refund','leave_unapplied','reserve_for_backorder') NOT NULL DEFAULT 'none',
  child_so_id INT NULL,
  credit_note_id INT NULL,
  outstanding_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency_code VARCHAR(10) NOT NULL DEFAULT 'AUD',
  accounting_action ENUM('none','resize_document','credit_note') NOT NULL DEFAULT 'none',
  state ENUM('processing','xero_pending','complete','failed','unknown') NOT NULL DEFAULT 'processing',
  safe_error VARCHAR(500) NULL,
  response_json JSON NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  UNIQUE KEY uq_so_shortfall_operation (business_id, operation_key),
  INDEX idx_so_shortfall_source (business_id, source_so_id, created_at),
  INDEX idx_so_shortfall_child (business_id, child_so_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_customer_credit_settlements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  resolution_id BIGINT NOT NULL,
  action_key VARCHAR(191) NOT NULL,
  action_type ENUM('refund','leave_unapplied','reserve_for_order','allocate_to_invoice','allocate_to_source') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  target_so_id INT NULL,
  target_xero_document_id VARCHAR(100) NULL,
  account_code VARCHAR(50) NULL,
  status ENUM('planned','running','succeeded','failed','unknown','released') NOT NULL DEFAULT 'planned',
  xero_id VARCHAR(100) NULL,
  safe_error VARCHAR(500) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  UNIQUE KEY uq_customer_credit_action (business_id, action_key),
  INDEX idx_customer_credit_resolution (business_id, resolution_id),
  INDEX idx_customer_credit_target (business_id, target_so_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_po_shortfall_resolutions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  operation_key VARCHAR(191) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  source_po_id INT NOT NULL,
  outcome ENUM('leave_partial','cancel_remainder','create_backorder') NOT NULL,
  settlement ENUM('none','supplier_refund','leave_unapplied','reserve_for_new_po') NOT NULL DEFAULT 'none',
  child_po_id INT NULL,
  supplier_credit_note_id INT NULL,
  supplier_credit_ref VARCHAR(255) NULL,
  evidence_note VARCHAR(500) NULL,
  outstanding_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency_code VARCHAR(10) NOT NULL DEFAULT 'AUD',
  accounting_action ENUM('none','resize_document','credit_note') NOT NULL DEFAULT 'none',
  state ENUM('processing','xero_pending','complete','failed','unknown') NOT NULL DEFAULT 'processing',
  safe_error VARCHAR(500) NULL,
  response_json JSON NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  UNIQUE KEY uq_po_shortfall_operation (business_id, operation_key),
  INDEX idx_po_shortfall_source (business_id, source_po_id, created_at),
  INDEX idx_po_shortfall_child (business_id, child_po_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_supplier_credit_settlements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  resolution_id BIGINT NOT NULL,
  action_key VARCHAR(191) NOT NULL,
  action_type ENUM('supplier_refund','leave_unapplied','reserve_for_order','allocate_to_bill','allocate_to_source') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  target_po_id INT NULL,
  target_xero_document_id VARCHAR(100) NULL,
  account_code VARCHAR(50) NULL,
  status ENUM('planned','running','succeeded','failed','unknown','released') NOT NULL DEFAULT 'planned',
  xero_id VARCHAR(100) NULL,
  safe_error VARCHAR(500) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  UNIQUE KEY uq_supplier_credit_action (business_id, action_key),
  INDEX idx_supplier_credit_resolution (business_id, resolution_id),
  INDEX idx_supplier_credit_target (business_id, target_po_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Backorder Line Provenance ───────────────────────────────
-- A destination backorder may contain quantities from multiple source orders.
CREATE TABLE IF NOT EXISTS ims_po_backorder_lines (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id         VARCHAR(100) NOT NULL,
  operation_key       VARCHAR(191) NOT NULL,
  source_po_id        INT NOT NULL,
  source_po_item_id   INT NOT NULL,
  backorder_po_id     INT NOT NULL,
  backorder_po_item_id INT NOT NULL,
  transferred_qty     DECIMAL(12,4) NOT NULL,
  source_item_snapshot JSON NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_po_backorder_operation_line (business_id, operation_key, source_po_item_id),
  INDEX idx_po_backorder_source (business_id, source_po_id),
  INDEX idx_po_backorder_destination (business_id, backorder_po_id),
  FOREIGN KEY (source_po_id) REFERENCES ims_purchase_orders(id),
  FOREIGN KEY (backorder_po_id) REFERENCES ims_purchase_orders(id),
  FOREIGN KEY (backorder_po_item_id) REFERENCES ims_purchase_order_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_so_backorder_lines (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id         VARCHAR(100) NOT NULL,
  operation_key       VARCHAR(191) NOT NULL,
  source_so_id        INT NOT NULL,
  source_so_item_id   INT NOT NULL,
  backorder_so_id     INT NOT NULL,
  backorder_so_item_id INT NOT NULL,
  transferred_qty     DECIMAL(12,4) NOT NULL,
  source_item_snapshot JSON NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_so_backorder_operation_line (business_id, operation_key, source_so_item_id),
  INDEX idx_so_backorder_source (business_id, source_so_id),
  INDEX idx_so_backorder_destination (business_id, backorder_so_id),
  FOREIGN KEY (source_so_id) REFERENCES ims_sales_orders(id),
  FOREIGN KEY (backorder_so_id) REFERENCES ims_sales_orders(id),
  FOREIGN KEY (backorder_so_item_id) REFERENCES ims_sales_order_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_backorder_merges (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id         VARCHAR(100) NOT NULL,
  operation_key       VARCHAR(191) NOT NULL,
  request_hash        CHAR(64) NOT NULL,
  backorder_type      ENUM('customer','supplier') NOT NULL,
  target_order_id     INT NOT NULL,
  source_order_ids    JSON NOT NULL,
  response_json       JSON NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at        DATETIME NULL,
  UNIQUE KEY uq_backorder_merge_operation (business_id, operation_key),
  INDEX idx_backorder_merge_target (business_id, backorder_type, target_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Customer Credit Notes / Returns ─────────────────────────
CREATE TABLE IF NOT EXISTS ims_credit_notes (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  business_id         VARCHAR(150) NOT NULL,
  cn_number           VARCHAR(30)  NOT NULL,
  customer_id         INT          NULL,
  so_id               INT          NULL,
  original_so_number  VARCHAR(100) NULL,
  location_id         INT          NOT NULL,
  status              ENUM('draft','awaiting_product','complete','cancelled','reversed') NOT NULL DEFAULT 'draft',
  source              ENUM('manual','shopify','pos','so_shortfall') NOT NULL DEFAULT 'manual',
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
  reference           VARCHAR(255) NULL COMMENT 'e.g. original SO or invoice number',
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
  created_at          DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business (business_id),
  INDEX idx_status (status),
  INDEX idx_customer (customer_id),
  INDEX idx_shopify_return (business_id, shopify_return_id),
  UNIQUE KEY uq_business_cn (business_id, cn_number),
  UNIQUE INDEX uq_cn_pos_sale (business_id, pos_sale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_credit_note_items (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  cn_id        INT           NOT NULL,
  variant_id   VARCHAR(100)  NULL,
  code         VARCHAR(100)  NULL,
  name         VARCHAR(255)  NULL,
  qty          DECIMAL(10,4) NOT NULL DEFAULT 1,
  unit_price   DECIMAL(12,4) NOT NULL DEFAULT 0,
  price_basis  ENUM('cost','wholesale','rrp','custom') NOT NULL DEFAULT 'custom',
  restock      TINYINT(1)    NOT NULL DEFAULT 1,
  source_so_item_id INT      NULL,
  tax_rate     DECIMAL(6,4)  NOT NULL DEFAULT 0,
  line_total   DECIMAL(12,4) NOT NULL DEFAULT 0,
  INDEX idx_cn (cn_id),
  INDEX idx_cn_source_so_item (source_so_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Supplier Credit Notes ───────────────────────────────────
CREATE TABLE IF NOT EXISTS ims_supplier_credit_notes (
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
  reference           VARCHAR(255) NULL COMMENT 'e.g. original PO / bill number',
  supplier_credit_ref VARCHAR(100) NULL COMMENT 'the supplier''s own credit note number',
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
  created_at          DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_business_scn (business_id, scn_number),
  INDEX idx_business (business_id),
  INDEX idx_status (status),
  INDEX idx_supplier (supplier_id),
  INDEX idx_po (po_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_supplier_credit_note_items (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  scn_id       INT           NOT NULL,
  variant_id   VARCHAR(100)  NULL,
  code         VARCHAR(100)  NULL,
  name         VARCHAR(255)  NULL,
  qty          DECIMAL(10,4) NOT NULL DEFAULT 1,
  unit_cost    DECIMAL(12,4) NOT NULL DEFAULT 0,
  restock      TINYINT(1)    NOT NULL DEFAULT 1,
  source_po_item_id INT      NULL,
  tax_rate     DECIMAL(6,4)  NOT NULL DEFAULT 0,
  line_total   DECIMAL(12,4) NOT NULL DEFAULT 0,
  INDEX idx_scn (scn_id),
  INDEX idx_scn_source_po_item (source_po_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_supplier_credit_note_files (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  scn_id        INT          NOT NULL,
  business_id   VARCHAR(100) NOT NULL,
  filename      VARCHAR(255) NOT NULL,
  original_name VARCHAR(255),
  mime_type     VARCHAR(100),
  file_size     INT,
  uploaded_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_scn (scn_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Stock Movements (audit trail) ────────────────────────────
CREATE TABLE IF NOT EXISTS ims_stock_movements (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  business_id    VARCHAR(100) NOT NULL DEFAULT '',
  variant_id     VARCHAR(36) NOT NULL,
  location_id    INT NOT NULL,
  movement_type  ENUM(
    'po_approved','po_unapproved','po_received',
    'so_confirmed','so_unconfirmed','so_fulfilled',
    'cn_returned','scn_returned','cn_return_reversed','scn_return_reversed',
    'adjustment','transfer_in','transfer_out',
    'pos_sale','pos_return','stocktake','stocktake_reverted'
  ) NOT NULL,
  reference_type ENUM('purchase_order','sales_order','credit_note','supplier_credit_note','manual','pos_sale','stocktake','branch_transfer') NOT NULL,
  reference_id   INT,
  qty_change     DECIMAL(12,4) NOT NULL,
  qty_after_soh  DECIMAL(12,4) NOT NULL,
  unit_cost      DECIMAL(12,4),
  notes          VARCHAR(500),
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sm_variant  (variant_id),
  INDEX idx_business_id (business_id),
  INDEX idx_sm_location (location_id),
  INDEX idx_sm_ref      (reference_type, reference_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Stocktakes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ims_stocktakes (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  business_id    VARCHAR(100) NOT NULL DEFAULT '',
  reference      VARCHAR(100) NOT NULL,
  location_id    INT NOT NULL,
  status         ENUM('draft','in_progress','completed','cancelled','reverted') NOT NULL DEFAULT 'draft',
  notes          TEXT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at   DATETIME NULL,
  reverted_at    DATETIME NULL,
  reversal_reason VARCHAR(500) NULL,
  reversed_by    INT NULL,
  xero_journal_id VARCHAR(100) NULL,
  xero_synced_at  DATETIME NULL,
  xero_sync_status ENUM('synced','queued','error') NULL,
  xero_reversal_journal_id VARCHAR(100) NULL,
  xero_reversal_synced_at DATETIME NULL,
  xero_reversal_sync_status ENUM('queued','synced','error','blocked','not_required') NULL,
  xero_reversal_error TEXT NULL,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business_id (business_id),
  INDEX idx_st_location (location_id),
  INDEX idx_st_status   (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_stocktake_items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  stocktake_id  INT NOT NULL,
  variant_id    VARCHAR(36) NOT NULL,
  expected_qty  DECIMAL(12,4) NOT NULL DEFAULT 0,
  counted_qty   DECIMAL(12,4) NULL,
  soh_at_apply  DECIMAL(12,4) NULL,
  applied_delta DECIMAL(12,4) NULL,
  unit_cost_at_apply DECIMAL(15,4) NULL,
  notes         VARCHAR(255) NULL,
  INDEX idx_sti_stocktake (stocktake_id),
  UNIQUE KEY uq_sti_variant (stocktake_id, variant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Branch Transfers ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ims_branch_transfers (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  business_id      VARCHAR(100) NOT NULL DEFAULT '',
  transfer_number  VARCHAR(50) NOT NULL UNIQUE,
  from_location_id INT NOT NULL,
  to_location_id   INT NOT NULL,
  status           ENUM('draft','sent','partial','received','cancelled') NOT NULL DEFAULT 'draft',
  transfer_date    DATE NOT NULL,
  notes            TEXT NULL,
  received_date    DATE NULL,
  total_value      DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business_id (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_branch_transfer_items (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  transfer_id  INT NOT NULL,
  variant_id   VARCHAR(50) NOT NULL,
  qty_sent     DECIMAL(10,4) NOT NULL DEFAULT 0,
  qty_received DECIMAL(10,4) NULL,
  unit_cost    DECIMAL(10,4) NOT NULL DEFAULT 0,
  line_value   DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes        TEXT NULL,
  FOREIGN KEY (transfer_id) REFERENCES ims_branch_transfers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- POS Tables
-- ============================================================

-- ── POS Users ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  business_id   VARCHAR(100) NOT NULL DEFAULT '',
  username      VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255),
  email         VARCHAR(255),
  phone         VARCHAR(50),
  branch_ids    JSON,           -- null = all branches allowed
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business_id (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── POS Registers ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_registers (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  location_id            INT NOT NULL,
  name                   VARCHAR(100) NOT NULL DEFAULT 'Default Register',
  default_float          DECIMAL(12,2) NOT NULL DEFAULT 200.00,
  is_active              TINYINT(1) NOT NULL DEFAULT 1,
  card_terminal_provider VARCHAR(50),
  zeller_site_id         VARCHAR(255),
  zeller_terminal_id     VARCHAR(255),
  zeller_api_key         TEXT,
  card_terminal_methods  TEXT,
  created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES ims_locations(id),
  INDEX idx_register_location (location_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── POS Register Sessions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_register_sessions (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  register_id       INT NOT NULL,
  location_id       INT NOT NULL,
  session_date      DATE NOT NULL,
  opened_at         DATETIME NOT NULL,
  closed_at         DATETIME,
  opened_by         VARCHAR(255),
  closed_by         VARCHAR(255),
  opening_float     DECIMAL(12,2),
  denomination_data JSON,
  status            ENUM('open','closed') NOT NULL DEFAULT 'open',
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (register_id) REFERENCES pos_registers(id),
  FOREIGN KEY (location_id) REFERENCES ims_locations(id),
  INDEX idx_prs_register (register_id, session_date),
  INDEX idx_prs_status (register_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── POS Sales ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_sales (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  business_id       VARCHAR(100) NOT NULL DEFAULT '',
  local_id          VARCHAR(100) UNIQUE,
  location_id       INT NOT NULL,
  register_id       INT NULL,
  register_session_id INT NULL,
  trading_date      DATE NULL,
  cashier_id        INT NULL,
  cashier_name      VARCHAR(255),
  sale_type         ENUM('sale','return','layby') NOT NULL DEFAULT 'sale',
  status            ENUM('open','parked','completed','voided','layby_active','layby_complete') NOT NULL DEFAULT 'open',
  customer_id       INT NULL,
  credit_note_id    INT NULL,
  customer_name     VARCHAR(255),
  customer_phone    VARCHAR(50),
  subtotal          DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_total    DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_total         DECIMAL(12,2) NOT NULL DEFAULT 0,
  total             DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes             TEXT,
  parked_label      VARCHAR(100),
  return_of_sale_id INT,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at      DATETIME,
  is_historical     TINYINT(1) NOT NULL DEFAULT 0,
  cash_rounding     DECIMAL(10,2) NOT NULL DEFAULT 0,
  loyalty_earn_rate DECIMAL(12,4) NULL,
  FOREIGN KEY (location_id) REFERENCES ims_locations(id),
  INDEX idx_pos_loc_date (location_id, created_at),
  INDEX idx_business_id (business_id),
  INDEX idx_ps_register (register_id),
  INDEX idx_ps_session (register_session_id),
  INDEX idx_ps_customer (customer_id),
  UNIQUE INDEX uq_ps_credit_note (business_id, credit_note_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── POS Sale Items ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_sale_items (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  business_id     VARCHAR(100) NOT NULL DEFAULT '',
  sale_id         INT NOT NULL,
  return_of_sale_item_id INT NULL,
  is_gift_card    TINYINT(1) NOT NULL DEFAULT 0,
  variant_id      VARCHAR(36),
  code            VARCHAR(100),
  name            VARCHAR(500) NOT NULL,
  qty             DECIMAL(12,4) NOT NULL,
  unit_price      DECIMAL(12,2) NOT NULL,
  original_price  DECIMAL(12,2),
  discount_type   ENUM('none','percent','amount') NOT NULL DEFAULT 'none',
  discount_value  DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_rate        DECIMAL(5,2)  NOT NULL DEFAULT 10.00,
  line_total      DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (sale_id) REFERENCES pos_sales(id) ON DELETE CASCADE,
  INDEX idx_business_id (business_id),
  INDEX idx_psi_sale (sale_id),
  INDEX idx_psi_return_source (return_of_sale_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── POS Payments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_payments (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  business_id    VARCHAR(100) NOT NULL DEFAULT '',
  sale_id        INT NOT NULL,
  payment_method VARCHAR(100) NOT NULL,
  amount         DECIMAL(12,2) NOT NULL,
  reference      VARCHAR(255),
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sale_id) REFERENCES pos_sales(id) ON DELETE CASCADE,
  INDEX idx_business_id (business_id),
  INDEX idx_pp_sale   (sale_id),
  INDEX idx_pp_method (payment_method, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── POS EOD Reconciliations ───────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_eod_reconciliations (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  business_id       VARCHAR(100) NOT NULL DEFAULT '',
  location_id       INT NOT NULL,
  register_id       INT NULL,
  register_session_id INT NULL,
  cashier_id        INT NULL,
  cashier_name      VARCHAR(255),
  recon_date        DATE NOT NULL,
  payment_method    VARCHAR(100) NOT NULL,
  expected_amount   DECIMAL(12,2),
  counted_amount    DECIMAL(12,2),
  opening_float     DECIMAL(12,2),
  denomination_data JSON,
  notes             TEXT,
  xero_invoice_id   VARCHAR(100) NULL,
  xero_synced_at    DATETIME     NULL,
  xero_payment_required TINYINT(1) NOT NULL DEFAULT 0,
  xero_payment_id   VARCHAR(100) NULL,
  xero_payment_synced_at DATETIME NULL,
  xero_payment_error TEXT NULL,
  xero_clearing_account_code VARCHAR(20) NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_eod (location_id, register_id, recon_date, payment_method),
  INDEX idx_eod_loc_date (location_id, recon_date),
  INDEX idx_business_id (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── POS Petty Cash Withdrawals ───────────────────────────────
CREATE TABLE IF NOT EXISTS pos_petty_cash_transactions (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id         VARCHAR(100) NOT NULL,
  operation_key       VARCHAR(191) NOT NULL,
  location_id         INT NOT NULL,
  register_id         INT NULL,
  register_session_id INT NOT NULL,
  transaction_date    DATE NOT NULL,
  amount               DECIMAL(12,2) NOT NULL,
  gst_treatment        ENUM('gst','bas_excluded') NOT NULL DEFAULT 'gst',
  gst_amount           DECIMAL(12,2) NOT NULL DEFAULT 0,
  reason               VARCHAR(500) NOT NULL,
  evidence_type        ENUM('receipt','admin_attestation') NOT NULL DEFAULT 'receipt',
  evidence_note        VARCHAR(500) NULL,
  receipt_original_name VARCHAR(255) NOT NULL,
  receipt_stored_name   VARCHAR(255) NOT NULL,
  receipt_mime_type     VARCHAR(100) NOT NULL,
  receipt_file_size     INT UNSIGNED NOT NULL,
  cashier_id           INT NULL,
  cashier_name         VARCHAR(255) NULL,
  status               ENUM('recorded','voided') NOT NULL DEFAULT 'recorded',
  voided_at            DATETIME NULL,
  voided_by_name       VARCHAR(255) NULL,
  void_reason          VARCHAR(500) NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pos_petty_cash_operation (business_id, operation_key),
  INDEX idx_pos_petty_cash_session (business_id, register_session_id, status),
  INDEX idx_pos_petty_cash_location_date (business_id, location_id, transaction_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wholesale_draft_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(64) NOT NULL,
  contact_id INT NOT NULL,
  wholesale_company_id INT NULL,
  wholesale_location_id INT NULL,
  wholesale_member_id INT NULL,
  is_staff_preview_test TINYINT(1) NOT NULL DEFAULT 0,
  staff_preview_session_id VARCHAR(64) NULL,
  staff_preview_actor_user_id INT NULL,
  staff_preview_actor_name VARCHAR(255) NULL,
  status ENUM('draft','submitted','cancelled') NOT NULL DEFAULT 'draft',
  reference VARCHAR(100) NULL,
  notes TEXT NULL,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  submitted_at DATETIME NULL,
  so_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_biz_contact (business_id, contact_id),
  INDEX idx_wholesale_draft_account (business_id, wholesale_company_id, wholesale_location_id, wholesale_member_id),
  INDEX idx_wholesale_draft_preview (business_id, is_staff_preview_test, staff_preview_session_id),
  INDEX idx_status (status),
  CONSTRAINT fk_wholesale_draft_company FOREIGN KEY (wholesale_company_id) REFERENCES ims_wholesale_companies(id) ON DELETE SET NULL,
  CONSTRAINT fk_wholesale_draft_location FOREIGN KEY (wholesale_location_id) REFERENCES ims_wholesale_company_locations(id) ON DELETE SET NULL,
  CONSTRAINT fk_wholesale_draft_member FOREIGN KEY (wholesale_member_id) REFERENCES ims_wholesale_company_members(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wholesale_draft_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  variant_id VARCHAR(64) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  variant_label VARCHAR(255) NULL,
  sku VARCHAR(100) NULL,
  qty INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,
  is_indent TINYINT(1) NOT NULL DEFAULT 0,
  indent_qty DECIMAL(12,4) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_order (order_id),
  CONSTRAINT fk_wdoi_order FOREIGN KEY (order_id) REFERENCES wholesale_draft_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Sales Cache (precomputed aggregates — mirrors Cin7 products table) ────────
CREATE TABLE IF NOT EXISTS ims_sales_history (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id    VARCHAR(100) NOT NULL DEFAULT '',
  cin7_order_id  VARCHAR(100) NOT NULL,
  variant_id     VARCHAR(100) NULL,
  cin7_option_id INT NULL,
  sku            VARCHAR(100) NULL,
  product_name   VARCHAR(255) NULL,
  branch_id      INT NULL,
  invoice_date   DATE NULL,
  qty            DECIMAL(10,4) DEFAULT 0,
  unit_price     DECIMAL(12,4) DEFAULT 0,
  line_total     DECIMAL(12,4) DEFAULT 0,
  amount_due     DECIMAL(12,4) NULL,
  source         VARCHAR(100) NULL,
  reference      VARCHAR(100) NULL,
  stage          VARCHAR(100) NULL,
  INDEX idx_business_id (business_id),
  INDEX idx_variant_id (variant_id),
  INDEX idx_invoice_date (invoice_date),
  INDEX idx_cin7_order_id (cin7_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Refreshed on demand via POST /api/ims/refresh-sales-cache
-- Combines ims_sales_orders (fulfilled) + pos_sales (completed) + ims_stock
CREATE TABLE IF NOT EXISTS ims_sales_cache (
  variant_id       VARCHAR(36)    NOT NULL,
  business_id      VARCHAR(100)   NOT NULL DEFAULT '',
  sales_qty_7d     DECIMAL(12,4)  NOT NULL DEFAULT 0,
  sales_qty_90d    DECIMAL(12,4)  NOT NULL DEFAULT 0,
  sales_qty_180d   DECIMAL(12,4)  NOT NULL DEFAULT 0,
  sales_qty_12m    DECIMAL(12,4)  NOT NULL DEFAULT 0,
  global_soh       DECIMAL(12,4)  NOT NULL DEFAULT 0,
  global_available DECIMAL(12,4)  NOT NULL DEFAULT 0,
  global_incoming  DECIMAL(12,4)  NOT NULL DEFAULT 0,
  updated_at       DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (variant_id),
  INDEX idx_business_id (business_id),
  CONSTRAINT fk_isc_variant FOREIGN KEY (variant_id)
    REFERENCES ims_product_variants(variant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- In-app notifications (errors, warnings, info from background processes)
CREATE TABLE IF NOT EXISTS ims_notifications (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(64)  NOT NULL,
  type        VARCHAR(20)  NOT NULL DEFAULT 'error',
  source      VARCHAR(64)  NOT NULL,
  title       VARCHAR(255) NOT NULL,
  message     TEXT         NOT NULL,
  detail      JSON         NULL,
  is_read     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_noti_biz    (business_id, created_at),
  INDEX idx_noti_unread (business_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gift cards (manually created or imported from Shopify/Sage)
CREATE TABLE IF NOT EXISTS gift_cards (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  shopify_gc_id           BIGINT         NULL     COMMENT 'Shopify gift card numeric ID',
  shopify_line_item_id    BIGINT         NULL     COMMENT 'Shopify line_item_id (order line)',
  code                    VARCHAR(100)   NOT NULL,
  initial_balance         DECIMAL(12,2)  NULL     COMMENT 'Face value when issued; NULL = unknown (imported)',
  balance                 DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  currency                VARCHAR(10)    NOT NULL DEFAULT 'AUD',
  status                  ENUM('active','redeemed','cancelled','expired') NOT NULL DEFAULT 'active',
  expires_on              DATE           NULL     COMMENT 'Card expiry date (Shopify default: 3 years)',
  customer_id             VARCHAR(255)   NULL     COMMENT 'External customer ID (Shopify UUID, etc.)',
  order_id                VARCHAR(255)   NULL     COMMENT 'External order ID, "imported", or NULL for manual',
  recipient_email         VARCHAR(255)   NULL,
  notes                   TEXT           NULL,
  created_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at            DATETIME       NULL,
  updated_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gift_card_code     (code),
  UNIQUE KEY uq_shopify_gc_id      (shopify_gc_id),
  INDEX idx_gc_status              (status),
  INDEX idx_gc_customer            (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  card_id       INT NOT NULL,
  type          ENUM('issue','redeem','return','adjust') NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  pos_sale_id   INT NULL,
  credit_note_id INT NULL,
  idempotency_key VARCHAR(191) NULL,
  notes         VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gct_card (card_id),
  INDEX idx_gct_sale (pos_sale_id),
  CONSTRAINT fk_gct_card FOREIGN KEY (card_id) REFERENCES gift_cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS store_credit_transactions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  contact_id    INT NOT NULL,
  type          ENUM('issue','redeem','adjust') NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  pos_sale_id   INT NULL,
  credit_note_id INT NULL,
  idempotency_key VARCHAR(191) NULL,
  notes         VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sct_contact (contact_id),
  INDEX idx_sct_sale    (pos_sale_id),
  INDEX idx_sct_credit_note (credit_note_id),
  UNIQUE INDEX uq_sct_idempotency (idempotency_key),
  CONSTRAINT fk_sct_contact FOREIGN KEY (contact_id) REFERENCES ims_contacts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Loyalty Program ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty_accounts (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  business_id       VARCHAR(100) NOT NULL,
  contact_id        INT NOT NULL,
  balance_points    INT NOT NULL DEFAULT 0,
  lifetime_earned   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  lifetime_redeemed BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status            ENUM('active','suspended','closed') NOT NULL DEFAULT 'active',
  enrolled_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loyalty_account (business_id, contact_id),
  INDEX idx_loyalty_account_business (business_id),
  CONSTRAINT fk_loyalty_account_contact FOREIGN KEY (contact_id) REFERENCES ims_contacts(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id     VARCHAR(100) NOT NULL,
  account_id      INT NOT NULL,
  type            ENUM('earn','redeem','earn_reversal','redeem_reversal','adjustment','migration') NOT NULL,
  points_delta    INT NOT NULL,
  balance_after   INT NOT NULL,
  eligible_spend_cents INT UNSIGNED NULL,
  channel         ENUM('pos','shopify','native_shop','manual','migration') NOT NULL,
  source_type     VARCHAR(50) NULL,
  source_id       VARCHAR(191) NULL,
  idempotency_key VARCHAR(191) NULL,
  actor_id        VARCHAR(150) NULL,
  reason          VARCHAR(500) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loyalty_transaction_idempotency (business_id, idempotency_key),
  INDEX idx_loyalty_transaction_account (business_id, account_id, created_at),
  INDEX idx_loyalty_transaction_source (business_id, source_type, source_id),
  INDEX idx_loyalty_transaction_type (business_id, type, created_at),
  CONSTRAINT fk_loyalty_transaction_account FOREIGN KEY (account_id) REFERENCES loyalty_accounts(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Native Online Shop ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ims_online_shop_products (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  product_id VARCHAR(36) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  meta_title VARCHAR(255) NULL,
  meta_description VARCHAR(500) NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  published_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_online_shop_product (business_id, product_id),
  UNIQUE KEY uq_online_shop_product_slug (business_id, slug),
  INDEX idx_online_shop_product_public (business_id, is_published, slug),
  CONSTRAINT fk_online_shop_product FOREIGN KEY (product_id) REFERENCES ims_products(product_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_online_shop_customers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  contact_id INT NOT NULL,
  normalized_email VARCHAR(320) NOT NULL,
  email_verified_at DATETIME NULL,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_online_shop_customer_email (business_id, normalized_email),
  UNIQUE KEY uq_online_shop_customer_contact (business_id, contact_id),
  CONSTRAINT fk_online_shop_customer_contact FOREIGN KEY (contact_id) REFERENCES ims_contacts(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_online_shop_addresses (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  customer_id BIGINT NOT NULL,
  label VARCHAR(80) NULL,
  recipient_name VARCHAR(255) NOT NULL,
  address VARCHAR(255) NOT NULL,
  address2 VARCHAR(255) NULL,
  suburb VARCHAR(100) NOT NULL,
  city VARCHAR(100) NULL,
  state VARCHAR(100) NOT NULL,
  postcode VARCHAR(20) NOT NULL,
  country VARCHAR(100) NOT NULL DEFAULT 'Australia',
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_online_shop_address_customer (business_id, customer_id, is_primary, id),
  CONSTRAINT fk_online_shop_address_customer FOREIGN KEY (customer_id) REFERENCES ims_online_shop_customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_online_shop_shipping_rules (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  name VARCHAR(120) NOT NULL,
  rule_type VARCHAR(32) NOT NULL DEFAULT 'flat',
  amount_cents INT UNSIGNED NOT NULL DEFAULT 0,
  free_over_cents INT UNSIGNED NULL,
  states_json JSON NULL,
  postcodes_json JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_online_shipping_rule_active (business_id, is_active, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_online_shop_pickup_locations (
  business_id VARCHAR(100) NOT NULL,
  location_id INT NOT NULL,
  display_name VARCHAR(255) NULL,
  instructions VARCHAR(1000) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, location_id),
  INDEX idx_online_pickup_active (business_id, is_active, sort_order),
  CONSTRAINT fk_online_pickup_location FOREIGN KEY (location_id) REFERENCES ims_locations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_online_shop_checkouts (
  checkout_id CHAR(36) PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  customer_id BIGINT NULL,
  guest_email VARCHAR(320) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  fulfilment_mode VARCHAR(32) NOT NULL DEFAULT 'single_location',
  fulfilment_type VARCHAR(32) NOT NULL DEFAULT 'delivery',
  location_id INT NOT NULL,
  shipping_rule_id BIGINT NULL,
  shipping_address_json JSON NULL,
  subtotal_cents INT UNSIGNED NOT NULL,
  tax_cents INT UNSIGNED NOT NULL,
  shipping_cents INT UNSIGNED NOT NULL DEFAULT 0,
  loyalty_cents INT UNSIGNED NOT NULL DEFAULT 0,
  store_credit_cents INT UNSIGNED NOT NULL DEFAULT 0,
  total_cents INT UNSIGNED NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'AUD',
  expires_at DATETIME NOT NULL,
  completed_so_id INT NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_online_checkout_status (business_id, status, expires_at),
  INDEX idx_online_checkout_customer (business_id, customer_id, created_at),
  CONSTRAINT fk_online_checkout_customer FOREIGN KEY (customer_id) REFERENCES ims_online_shop_customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_online_checkout_location FOREIGN KEY (location_id) REFERENCES ims_locations(id),
  CONSTRAINT fk_online_checkout_shipping_rule FOREIGN KEY (shipping_rule_id) REFERENCES ims_online_shop_shipping_rules(id) ON DELETE SET NULL,
  CONSTRAINT fk_online_checkout_so FOREIGN KEY (completed_so_id) REFERENCES ims_sales_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_online_shop_fulfilment_groups (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  checkout_id CHAR(36) NOT NULL,
  location_id INT NOT NULL,
  completed_so_id INT NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_online_fulfilment_group (checkout_id, location_id),
  INDEX idx_online_fulfilment_group_business (business_id, checkout_id),
  CONSTRAINT fk_online_fulfilment_checkout FOREIGN KEY (checkout_id) REFERENCES ims_online_shop_checkouts(checkout_id) ON DELETE CASCADE,
  CONSTRAINT fk_online_fulfilment_location FOREIGN KEY (location_id) REFERENCES ims_locations(id),
  CONSTRAINT fk_online_fulfilment_so FOREIGN KEY (completed_so_id) REFERENCES ims_sales_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_online_shop_checkout_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  checkout_id CHAR(36) NOT NULL,
  variant_id VARCHAR(36) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price_cents INT UNSIGNED NOT NULL,
  tax_cents INT UNSIGNED NOT NULL,
  line_total_cents INT UNSIGNED NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  variant_label VARCHAR(255) NULL,
  sku VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_online_checkout_variant (checkout_id, variant_id),
  INDEX idx_online_checkout_item_business (business_id, checkout_id),
  CONSTRAINT fk_online_checkout_item_checkout FOREIGN KEY (checkout_id) REFERENCES ims_online_shop_checkouts(checkout_id) ON DELETE CASCADE,
  CONSTRAINT fk_online_checkout_item_variant FOREIGN KEY (variant_id) REFERENCES ims_product_variants(variant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_online_shop_stock_reservations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  checkout_id CHAR(36) NOT NULL,
  variant_id VARCHAR(36) NOT NULL,
  location_id INT NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  expires_at DATETIME NOT NULL,
  released_at DATETIME NULL,
  converted_so_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_online_stock_reservation (checkout_id, variant_id, location_id),
  INDEX idx_online_stock_reservation_active (business_id, variant_id, location_id, status, expires_at),
  CONSTRAINT fk_online_stock_reservation_checkout FOREIGN KEY (checkout_id) REFERENCES ims_online_shop_checkouts(checkout_id) ON DELETE CASCADE,
  CONSTRAINT fk_online_stock_reservation_variant FOREIGN KEY (variant_id) REFERENCES ims_product_variants(variant_id),
  CONSTRAINT fk_online_stock_reservation_location FOREIGN KEY (location_id) REFERENCES ims_locations(id),
  CONSTRAINT fk_online_stock_reservation_so FOREIGN KEY (converted_so_id) REFERENCES ims_sales_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_online_shop_payment_attempts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  checkout_id CHAR(36) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  provider_payment_id VARCHAR(191) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  status VARCHAR(50) NOT NULL,
  amount_cents INT UNSIGNED NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'AUD',
  safe_error VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_online_payment_provider_id (business_id, provider, provider_payment_id),
  UNIQUE KEY uq_online_payment_idempotency (business_id, idempotency_key),
  INDEX idx_online_payment_checkout (business_id, checkout_id, created_at),
  CONSTRAINT fk_online_payment_checkout FOREIGN KEY (checkout_id) REFERENCES ims_online_shop_checkouts(checkout_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_online_shop_payment_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  provider_event_id VARCHAR(191) NOT NULL,
  provider_payment_id VARCHAR(191) NULL,
  event_type VARCHAR(100) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'received',
  safe_error VARCHAR(500) NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  UNIQUE KEY uq_online_payment_event (business_id, provider, provider_event_id),
  INDEX idx_online_payment_event_status (business_id, status, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ims_online_shop_value_reservations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  checkout_id CHAR(36) NOT NULL,
  contact_id INT NOT NULL,
  value_type VARCHAR(32) NOT NULL,
  points INT UNSIGNED NULL,
  amount_cents INT UNSIGNED NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  idempotency_key VARCHAR(191) NOT NULL,
  expires_at DATETIME NOT NULL,
  finalized_at DATETIME NULL,
  released_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_online_value_reservation_key (business_id, idempotency_key),
  INDEX idx_online_value_reservation_active (business_id, contact_id, value_type, status, expires_at),
  CONSTRAINT fk_online_value_reservation_checkout FOREIGN KEY (checkout_id) REFERENCES ims_online_shop_checkouts(checkout_id) ON DELETE CASCADE,
  CONSTRAINT fk_online_value_reservation_contact FOREIGN KEY (contact_id) REFERENCES ims_contacts(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_rewards (
  id                           INT AUTO_INCREMENT PRIMARY KEY,
  business_id                  VARCHAR(100) NOT NULL,
  reward_code                  VARCHAR(50) NOT NULL,
  display_name                 VARCHAR(255) NOT NULL,
  description                  TEXT NULL,
  points_cost                  INT UNSIGNED NOT NULL,
  value_aud                    DECIMAL(12,2) NOT NULL,
  is_active                    TINYINT(1) NOT NULL DEFAULT 1,
  sort_order                   INT NOT NULL DEFAULT 0,
  shopify_discount_template_id VARCHAR(100) NULL,
  metadata_json                MEDIUMTEXT NULL,
  created_at                   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loyalty_reward_code (business_id, reward_code),
  INDEX idx_loyalty_reward_active (business_id, is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id         VARCHAR(100) NOT NULL,
  account_id          INT NOT NULL,
  reward_id           INT NOT NULL,
  transaction_id      BIGINT NOT NULL,
  status              ENUM('reserved','issued','used','cancelled','expired') NOT NULL DEFAULT 'reserved',
  points_deducted     INT UNSIGNED NOT NULL,
  idempotency_key     VARCHAR(191) NOT NULL,
  pos_sale_id         INT NULL,
  shopify_discount_id VARCHAR(100) NULL,
  voucher_code        VARCHAR(100) NULL,
  used_at             DATETIME NULL,
  cancelled_at        DATETIME NULL,
  cancelled_reason    VARCHAR(500) NULL,
  actor_id            VARCHAR(150) NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loyalty_redemption_idempotency (business_id, idempotency_key),
  INDEX idx_loyalty_redemption_account (business_id, account_id, status, created_at),
  INDEX idx_loyalty_redemption_status (business_id, status, created_at),
  INDEX idx_loyalty_redemption_voucher (business_id, voucher_code),
  CONSTRAINT fk_loyalty_redemption_account FOREIGN KEY (account_id) REFERENCES loyalty_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_loyalty_redemption_reward FOREIGN KEY (reward_id) REFERENCES loyalty_rewards(id) ON DELETE RESTRICT,
  CONSTRAINT fk_loyalty_redemption_transaction FOREIGN KEY (transaction_id) REFERENCES loyalty_transactions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
