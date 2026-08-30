-- =========================================================
-- Marketoir — Full Database Schema
-- MariaDB 10.11 / readyedu_Solvantis
-- =========================================================
SET NAMES utf8mb4;

-- ---------------------------------------------------------
-- businesses
-- Maps to the legacy Google Sheets spreadsheetId (databaseId)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS businesses (
  business_id         VARCHAR(100) PRIMARY KEY,
  name                VARCHAR(255) NOT NULL,
  drive_folder_id     VARCHAR(100),
  inventory_sheet_id  VARCHAR(100),
  marketing_sheet_id  VARCHAR(100),
  is_sandbox          TINYINT(1) NOT NULL DEFAULT 0,
  automation_paused   TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS business_feature_flags (
  business_id        VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  feature_key        VARCHAR(100) NOT NULL,
  enabled            TINYINT(1) NOT NULL DEFAULT 0,
  changed_by_user_id INT NULL,
  changed_by_name    VARCHAR(255) NULL,
  changed_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (business_id, feature_key),
  INDEX idx_business_feature_enabled (feature_key, enabled, business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- online sales channel and native shop control plane
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_online_channels (
  business_id          VARCHAR(100) PRIMARY KEY,
  active_channel       ENUM('none','shopify','native_shop') NOT NULL DEFAULT 'none',
  shopify_enabled      TINYINT(1) NOT NULL DEFAULT 0,
  native_shop_enabled  TINYINT(1) NOT NULL DEFAULT 0,
  changed_by_user_id   INT NULL,
  changed_by_name      VARCHAR(255) NULL,
  changed_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_business_online_channels_active (active_channel, business_id),
  INDEX idx_business_online_channels_shopify (shopify_enabled, business_id),
  INDEX idx_business_online_channels_native (native_shop_enabled, business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS online_shop_profiles (
  business_id          VARCHAR(100) PRIMARY KEY,
  slug                 VARCHAR(80) NOT NULL,
  display_name         VARCHAR(255) NOT NULL,
  logo_url             VARCHAR(2048) NULL,
  support_email        VARCHAR(320) NULL,
  default_meta_title   VARCHAR(255) NULL,
  default_meta_description VARCHAR(500) NULL,
  is_active            TINYINT(1) NOT NULL DEFAULT 0,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_online_shop_profiles_slug (slug),
  INDEX idx_online_shop_profiles_active (is_active, slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_portal_profiles (
  business_id          VARCHAR(100) PRIMARY KEY,
  slug                 VARCHAR(80) NOT NULL,
  display_name         VARCHAR(255) NOT NULL,
  logo_url             VARCHAR(2048) NULL,
  shopify_return_url   VARCHAR(2048) NOT NULL,
  terms_url            VARCHAR(2048) NOT NULL,
  terms_version        VARCHAR(100) NOT NULL,
  privacy_url          VARCHAR(2048) NOT NULL,
  policy_mode          VARCHAR(20) NOT NULL DEFAULT 'external',
  legal_name           VARCHAR(255) NULL,
  trading_name         VARCHAR(255) NULL,
  business_number      VARCHAR(100) NULL,
  policy_contact_email VARCHAR(320) NULL,
  policy_contact_address VARCHAR(1000) NULL,
  policy_jurisdiction  VARCHAR(100) NULL,
  current_policy_version_id BIGINT UNSIGNED NULL,
  is_active            TINYINT(1) NOT NULL DEFAULT 0,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_loyalty_portal_profiles_slug (slug),
  INDEX idx_loyalty_portal_profiles_active (is_active, slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_policy_versions (
  id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  version              VARCHAR(100) NOT NULL,
  policy_mode          VARCHAR(20) NOT NULL,
  terms_url            VARCHAR(2048) NOT NULL,
  privacy_url          VARCHAR(2048) NOT NULL,
  terms_markdown       LONGTEXT NULL,
  privacy_markdown     LONGTEXT NULL,
  merchant_snapshot_json JSON NULL,
  template_version     VARCHAR(100) NULL,
  content_hash         CHAR(64) NOT NULL,
  approved_by_user_id  INT NOT NULL,
  approved_by_name     VARCHAR(255) NOT NULL,
  published_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_loyalty_policy_business_version (business_id, version),
  INDEX idx_loyalty_policy_business_published (business_id, published_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS online_shop_domains (
  business_id          VARCHAR(100) PRIMARY KEY,
  domain_name          VARCHAR(253) NOT NULL,
  verification_token   VARCHAR(64) NOT NULL,
  status               ENUM('pending','verified','error') NOT NULL DEFAULT 'pending',
  is_active            TINYINT(1) NOT NULL DEFAULT 0,
  verified_at          DATETIME(3) NULL,
  last_checked_at      DATETIME(3) NULL,
  safe_error           VARCHAR(500) NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_online_shop_domain_name (domain_name),
  INDEX idx_online_shop_domain_active (is_active, status, domain_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS online_shop_layouts (
  business_id                 VARCHAR(100) PRIMARY KEY,
  schema_version              INT UNSIGNED NOT NULL DEFAULT 1,
  draft_json                  JSON NULL,
  published_json              JSON NULL,
  draft_revision              INT UNSIGNED NOT NULL DEFAULT 0,
  published_revision          INT UNSIGNED NOT NULL DEFAULT 0,
  draft_updated_by_user_id    INT NULL,
  draft_updated_by_name       VARCHAR(255) NULL,
  draft_updated_at            DATETIME(3) NULL,
  published_by_user_id        INT NULL,
  published_by_name           VARCHAR(255) NULL,
  published_at                DATETIME(3) NULL,
  created_at                  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS online_shop_assets (
  asset_id                    CHAR(36) PRIMARY KEY,
  business_id                 VARCHAR(100) NOT NULL,
  stored_filename             VARCHAR(255) NOT NULL,
  mime_type                   VARCHAR(100) NOT NULL,
  byte_size                   BIGINT UNSIGNED NOT NULL,
  original_name               VARCHAR(255) NOT NULL,
  alt_text                    VARCHAR(500) NULL,
  created_by_user_id          INT NULL,
  created_by_name             VARCHAR(255) NULL,
  is_active                   TINYINT(1) NOT NULL DEFAULT 1,
  created_at                  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_online_shop_asset_file (business_id, stored_filename),
  INDEX idx_online_shop_assets_active (business_id, is_active, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS online_shop_pages (
  page_id                      CHAR(36) PRIMARY KEY,
  business_id                  VARCHAR(100) NOT NULL,
  slug                         VARCHAR(100) NOT NULL,
  title                        VARCHAR(255) NOT NULL,
  meta_title                   VARCHAR(255) NULL,
  meta_description             VARCHAR(500) NULL,
  navigation_location          ENUM('none','header','footer','both') NOT NULL DEFAULT 'none',
  navigation_label             VARCHAR(100) NULL,
  sort_order                   INT NOT NULL DEFAULT 0,
  is_visible                   TINYINT(1) NOT NULL DEFAULT 0,
  schema_version               INT UNSIGNED NOT NULL DEFAULT 1,
  draft_json                   JSON NULL,
  published_json               JSON NULL,
  draft_revision               INT UNSIGNED NOT NULL DEFAULT 0,
  published_revision           INT UNSIGNED NOT NULL DEFAULT 0,
  draft_updated_by_user_id     INT NULL,
  draft_updated_by_name        VARCHAR(255) NULL,
  draft_updated_at             DATETIME(3) NULL,
  published_by_user_id         INT NULL,
  published_by_name            VARCHAR(255) NULL,
  published_at                 DATETIME(3) NULL,
  created_at                   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_online_shop_page_slug (business_id, slug),
  INDEX idx_online_shop_pages_navigation (business_id, is_visible, navigation_location, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS online_shop_otp_challenges (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  email                VARCHAR(320) NOT NULL,
  contact_id           INT NULL,
  purpose              VARCHAR(32) NOT NULL DEFAULT 'native_shop',
  challenge_token_hash CHAR(64) NOT NULL,
  code_hash            CHAR(64) NOT NULL,
  attempt_count        INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at           DATETIME(3) NOT NULL,
  consumed_at          DATETIME(3) NULL,
  verified_at          DATETIME(3) NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_online_shop_otp_token (challenge_token_hash),
  INDEX idx_online_shop_otp_email_active (business_id, purpose, email, consumed_at, expires_at),
  INDEX idx_online_shop_otp_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS online_shop_stripe_connections (
  business_id          VARCHAR(100) PRIMARY KEY,
  stripe_account_id    VARCHAR(64) NOT NULL,
  charges_enabled      TINYINT(1) NOT NULL DEFAULT 0,
  payouts_enabled      TINYINT(1) NOT NULL DEFAULT 0,
  details_submitted    TINYINT(1) NOT NULL DEFAULT 0,
  connected_by_user_id INT NULL,
  connected_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_online_shop_stripe_account (stripe_account_id),
  INDEX idx_online_shop_stripe_ready (charges_enabled, business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- wholesale supplier profiles (public-safe control plane)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS wholesale_supplier_profiles (
  business_id          VARCHAR(100) PRIMARY KEY,
  slug                 VARCHAR(80) NOT NULL,
  display_name         VARCHAR(255) NOT NULL,
  logo_url             VARCHAR(2048) NULL,
  support_email        VARCHAR(320) NULL,
  application_heading  VARCHAR(255) NULL,
  application_intro    TEXT NULL,
  terms_url            VARCHAR(2048) NULL,
  privacy_url          VARCHAR(2048) NULL,
  theme_json           JSON NULL,
  is_active            TINYINT(1) NOT NULL DEFAULT 1,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wholesale_supplier_profiles_slug (slug),
  INDEX idx_wholesale_supplier_profiles_active (is_active, slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wholesale_portal_layouts (
  business_id                 VARCHAR(100) PRIMARY KEY,
  schema_version              INT UNSIGNED NOT NULL DEFAULT 1,
  draft_json                  JSON NULL,
  published_json              JSON NULL,
  draft_revision              INT UNSIGNED NOT NULL DEFAULT 0,
  published_revision          INT UNSIGNED NOT NULL DEFAULT 0,
  draft_updated_by_user_id    INT NULL,
  draft_updated_by_name       VARCHAR(255) NULL,
  draft_updated_at            DATETIME(3) NULL,
  published_by_user_id        INT NULL,
  published_by_name           VARCHAR(255) NULL,
  published_at                DATETIME(3) NULL,
  created_at                  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wholesale_portal_assets (
  asset_id                    CHAR(36) PRIMARY KEY,
  business_id                 VARCHAR(100) NOT NULL,
  stored_filename             VARCHAR(255) NOT NULL,
  mime_type                   VARCHAR(100) NOT NULL,
  byte_size                   BIGINT UNSIGNED NOT NULL,
  original_name               VARCHAR(255) NOT NULL,
  alt_text                    VARCHAR(500) NULL,
  created_by_user_id          INT NULL,
  created_by_name             VARCHAR(255) NULL,
  is_active                   TINYINT(1) NOT NULL DEFAULT 1,
  created_at                  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wholesale_portal_asset_file (business_id, stored_filename),
  INDEX idx_wholesale_portal_assets_active (business_id, is_active, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wholesale_otp_challenges (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  contact_id           INT NOT NULL,
  email                VARCHAR(320) NOT NULL,
  challenge_token_hash CHAR(64) NOT NULL,
  code_hash            CHAR(64) NOT NULL,
  attempt_count        INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at           DATETIME(3) NOT NULL,
  consumed_at          DATETIME(3) NULL,
  verified_at          DATETIME(3) NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wholesale_otp_challenge_token (challenge_token_hash),
  INDEX idx_wholesale_otp_contact_active (business_id, contact_id, consumed_at, expires_at),
  INDEX idx_wholesale_otp_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wholesale_signup_requests (
  id                        BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id               VARCHAR(100) NOT NULL,
  company_name              VARCHAR(255) NOT NULL,
  contact_name              VARCHAR(255) NOT NULL,
  email                     VARCHAR(320) NOT NULL,
  phone                     VARCHAR(50) NULL,
  abn                       VARCHAR(32) NULL,
  applicant_message         TEXT NULL,
  status                    ENUM('pending_email','pending_review','approving','approved','rejected') NOT NULL DEFAULT 'pending_email',
  verification_token_hash   CHAR(64) NULL,
  verification_expires_at   DATETIME(3) NULL,
  email_verified_at         DATETIME(3) NULL,
  terms_version             VARCHAR(64) NOT NULL,
  privacy_version           VARCHAR(64) NOT NULL,
  consented_at              DATETIME(3) NOT NULL,
  linked_contact_id         INT NULL,
  linked_company_id         INT NULL,
  linked_location_id        INT NULL,
  linked_member_id          INT NULL,
  reviewed_by_user_id       INT NULL,
  reviewed_by_name          VARCHAR(255) NULL,
  reviewed_at               DATETIME(3) NULL,
  review_reason             VARCHAR(1000) NULL,
  created_at                DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wholesale_signup_business_email (business_id, email),
  UNIQUE KEY uq_wholesale_signup_verification_token (verification_token_hash),
  INDEX idx_wholesale_signup_queue (business_id, status, email_verified_at, created_at),
  INDEX idx_wholesale_signup_contact (business_id, linked_contact_id),
  INDEX idx_wholesale_signup_company (business_id, linked_company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wholesale_signup_review_events (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  application_id     BIGINT NOT NULL,
  business_id        VARCHAR(100) NOT NULL,
  event_type         ENUM('submitted','email_verified','approval_started','approved','rejected') NOT NULL,
  actor_user_id      INT NULL,
  actor_name         VARCHAR(255) NULL,
  reason             VARCHAR(1000) NULL,
  linked_contact_id  INT NULL,
  linked_company_id  INT NULL,
  linked_location_id INT NULL,
  linked_member_id   INT NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_wholesale_signup_events_application (business_id, application_id, created_at),
  CONSTRAINT fk_wholesale_signup_events_application
    FOREIGN KEY (application_id) REFERENCES wholesale_signup_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- users  (global — no business_id)
-- From master Users sheet: Name, Company, Email, Phone,
--   Password, UserSpreadsheetId, RegistrationDate
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(255),
  company       VARCHAR(255),
  email         VARCHAR(255) NOT NULL UNIQUE,
  phone         VARCHAR(50),
  password_hash VARCHAR(255) NOT NULL,
  business_id   VARCHAR(100),
  role          ENUM('admin','user') NOT NULL DEFAULT 'admin',
  mfa_totp_secret VARCHAR(255) NULL,
  mfa_enabled     TINYINT(1) NOT NULL DEFAULT 0,
  mfa_enabled_at  DATETIME(3) NULL,
  mfa_last_totp_step BIGINT NULL,
  registered_at DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- MFA security state (global main database)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  code_hash   CHAR(64) NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mfa_recovery_user_hash (user_id, code_hash),
  INDEX idx_mfa_recovery_user_available (user_id, consumed_at),
  CONSTRAINT fk_mfa_recovery_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mfa_preauth_sessions (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  token_hash    CHAR(64) NOT NULL,
  purpose       ENUM('enroll','challenge') NOT NULL,
  destination   VARCHAR(32) NOT NULL,
  expires_at    DATETIME(3) NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  consumed_at   DATETIME(3) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mfa_preauth_token_hash (token_hash),
  INDEX idx_mfa_preauth_user_active (user_id, consumed_at, expires_at),
  INDEX idx_mfa_preauth_expiry (expires_at),
  CONSTRAINT fk_mfa_preauth_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mfa_trusted_browsers (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  token_hash    CHAR(64) NOT NULL,
  display_label VARCHAR(191) NOT NULL,
  issued_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at    DATETIME(3) NOT NULL,
  last_used_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at    DATETIME(3) NULL,
  UNIQUE KEY uq_mfa_trusted_token_hash (token_hash),
  INDEX idx_mfa_trusted_user_active (user_id, revoked_at, expires_at),
  CONSTRAINT fk_mfa_trusted_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  action            VARCHAR(64) NOT NULL,
  subject_hash      CHAR(64) NOT NULL,
  failure_count     INT UNSIGNED NOT NULL DEFAULT 0,
  window_started_at DATETIME(3) NOT NULL,
  locked_until      DATETIME(3) NULL,
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (action, subject_hash),
  INDEX idx_auth_rate_limits_locked (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS super_admin_business_context_events (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id        INT NOT NULL,
  previous_business_id VARCHAR(100) NULL,
  target_business_id   VARCHAR(100) NOT NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_super_admin_context_actor (actor_user_id, created_at, id),
  INDEX idx_super_admin_context_target (target_business_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_business_memberships (
  user_id             INT NOT NULL,
  business_id         VARCHAR(100) NOT NULL,
  tier                ENUM('SuperAdmin','Admin','StandardUser','PosManager','PosUser','Advisor') NOT NULL DEFAULT 'StandardUser',
  is_default          TINYINT(1) NOT NULL DEFAULT 0,
  last_active_at      DATETIME(3) NULL,
  enrolled_by_user_id INT NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at          DATETIME(3) NULL,
  PRIMARY KEY (user_id, business_id),
  INDEX idx_user_business_memberships_business (business_id, deleted_at, user_id),
  INDEX idx_user_business_memberships_recent (user_id, deleted_at, last_active_at),
  CONSTRAINT fk_user_business_memberships_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_business_context_events (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id              INT NOT NULL,
  previous_business_id VARCHAR(100) NULL,
  target_business_id   VARCHAR(100) NOT NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_user_context_actor (user_id, created_at, id),
  INDEX idx_user_context_target (target_business_id, created_at, id),
  CONSTRAINT fk_user_context_actor FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- invites  (email invite tokens for adding users to a business)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS invites (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  token       VARCHAR(64) NOT NULL UNIQUE,
  email       VARCHAR(255) NOT NULL,
  business_id VARCHAR(100) NOT NULL,
  invited_by  INT NOT NULL,
  role        ENUM('admin','user') NOT NULL DEFAULT 'user',
  tier        ENUM('Admin','StandardUser','PosManager','PosUser','Advisor') NULL,
  expires_at  DATETIME NOT NULL,
  accepted_at DATETIME,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- config  (replaces Config!A:B key-value sheet)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS config (
  business_id VARCHAR(100) NOT NULL,
  `key`       VARCHAR(150) NOT NULL,
  value       TEXT,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, `key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- connections  (replaces Connections tab — encrypted creds)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS connections (
  business_id              VARCHAR(100) PRIMARY KEY,
  cin7_account_id          TEXT,
  cin7_api_key             TEXT,
  shopify_shop_id          TEXT,
  shopify_auth_mode        VARCHAR(32) NOT NULL DEFAULT 'legacy_token',
  shopify_access_token     TEXT,
  shopify_client_id        TEXT,
  shopify_client_secret    TEXT,
  shopify_token_expires_at BIGINT,
  meta_ad_account_id       TEXT,
  meta_access_token        TEXT,
  google_ads_customer_id   TEXT,
  google_ads_refresh_token TEXT,
  klaviyo_api_key          TEXT,
  gmail_email              TEXT,
  gmail_refresh_token      TEXT,
  website_sheet_id         TEXT,
  inventory_sheet_id       TEXT,
  gemini_model             VARCHAR(100),
  ai_document_extraction_model VARCHAR(100),
  ai_catalogue_matching_model VARCHAR(100),
  ai_business_intelligence_model VARCHAR(100),
  ai_customer_service_model VARCHAR(100),
  ga4_property_id          VARCHAR(50),
  xero_tenant_id           VARCHAR(100),
  xero_tenant_name         VARCHAR(255),
  xero_access_token        TEXT,
  xero_refresh_token       TEXT,
  xero_token_expiry        BIGINT,
  updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- AI billing control plane (cross-tenant, AUD micro-units)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_plans (
  plan_key       VARCHAR(32) PRIMARY KEY,
  display_name   VARCHAR(100) NOT NULL,
  description    VARCHAR(500) NULL,
  is_internal    TINYINT(1) NOT NULL DEFAULT 0,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS business_ai_accounts (
  business_id          VARCHAR(100) PRIMARY KEY,
  plan_key             VARCHAR(32) NOT NULL DEFAULT 'starter',
  funding_mode         ENUM('prepaid','account_limit') NOT NULL DEFAULT 'prepaid',
  enforcement_mode     ENUM('observe','enforce','suspended') NOT NULL DEFAULT 'observe',
  cycle_mode           ENUM('billing_anniversary','calendar_month','manual') NOT NULL DEFAULT 'manual',
  cycle_anchor_day     TINYINT UNSIGNED NOT NULL DEFAULT 1,
  cycle_timezone       VARCHAR(100) NOT NULL DEFAULT 'Australia/Sydney',
  cycle_started_at     DATETIME(3) NULL,
  cycle_ends_at        DATETIME(3) NULL,
  balance_micros       BIGINT NOT NULL DEFAULT 0,
  cycle_limit_micros   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  cycle_used_micros    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reserved_micros      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  warning_percent      TINYINT UNSIGNED NOT NULL DEFAULT 80,
  version              BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_ai_accounts_plan (plan_key),
  INDEX idx_ai_accounts_cycle_end (cycle_ends_at),
  INDEX idx_ai_accounts_enforcement (enforcement_mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_provider_rates (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider              VARCHAR(32) NOT NULL DEFAULT 'google',
  model_id              VARCHAR(150) NOT NULL,
  metric                ENUM('input_tokens','cached_input_tokens','output_tokens','thinking_tokens','output_image','video_second') NOT NULL,
  price_per_unit_micros  BIGINT UNSIGNED NOT NULL,
  unit_scale             INT UNSIGNED NOT NULL DEFAULT 1000000,
  source_currency        CHAR(3) NOT NULL DEFAULT 'USD',
  source_price_decimal   DECIMAL(20,8) NOT NULL,
  aud_fx_rate            DECIMAL(20,8) NOT NULL,
  effective_from         DATETIME(3) NOT NULL,
  effective_to           DATETIME(3) NULL,
  created_by             INT NULL,
  created_at             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ai_provider_rate (provider, model_id, metric, effective_from),
  INDEX idx_ai_provider_rate_lookup (provider, model_id, metric, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_plan_rates (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  plan_key              VARCHAR(32) NOT NULL,
  model_id              VARCHAR(150) NOT NULL,
  metric                ENUM('input_tokens','cached_input_tokens','output_tokens','thinking_tokens','output_image','video_second') NOT NULL,
  price_per_unit_micros  BIGINT UNSIGNED NOT NULL,
  unit_scale             INT UNSIGNED NOT NULL DEFAULT 1000000,
  effective_from         DATETIME(3) NOT NULL,
  effective_to           DATETIME(3) NULL,
  created_by             INT NULL,
  created_at             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ai_plan_rate (plan_key, model_id, metric, effective_from),
  INDEX idx_ai_plan_rate_lookup (plan_key, model_id, metric, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_usage_calls (
  id                        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  call_key                  VARCHAR(191) NOT NULL,
  parent_call_id            BIGINT UNSIGNED NULL,
  business_id               VARCHAR(100) NOT NULL,
  area                      VARCHAR(64) NOT NULL,
  operation                 VARCHAR(128) NOT NULL,
  actor_type                ENUM('user','cron','webhook','public','system') NOT NULL,
  actor_user_id             INT NULL,
  model_id                  VARCHAR(150) NOT NULL,
  reference_type            VARCHAR(64) NULL,
  reference_id              VARCHAR(191) NULL,
  status                    ENUM('reserved','submitted','settled','released','unknown','denied') NOT NULL,
  input_tokens              INT UNSIGNED NOT NULL DEFAULT 0,
  cached_input_tokens       INT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens             INT UNSIGNED NOT NULL DEFAULT 0,
  thinking_tokens           INT UNSIGNED NOT NULL DEFAULT 0,
  output_images             INT UNSIGNED NOT NULL DEFAULT 0,
  video_seconds             INT UNSIGNED NOT NULL DEFAULT 0,
  reserved_charge_micros    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  provider_cost_micros      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tenant_charge_micros      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  provider_rate_snapshot    JSON NULL,
  plan_rate_snapshot        JSON NULL,
  safe_error                VARCHAR(500) NULL,
  submitted_at              DATETIME(3) NULL,
  settled_at                DATETIME(3) NULL,
  created_at                DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ai_usage_call_key (call_key),
  INDEX idx_ai_usage_business_created (business_id, created_at),
  INDEX idx_ai_usage_area_created (area, created_at),
  INDEX idx_ai_usage_model_created (model_id, created_at),
  INDEX idx_ai_usage_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_account_ledger (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  idempotency_key       VARCHAR(191) NOT NULL,
  entry_type            ENUM('credit_grant','credit_removal','usage_charge','reservation_release','cycle_reset','limit_change','account_change','reconciliation') NOT NULL,
  amount_micros         BIGINT NOT NULL DEFAULT 0,
  balance_after_micros  BIGINT NOT NULL DEFAULT 0,
  cycle_used_after_micros BIGINT UNSIGNED NOT NULL DEFAULT 0,
  usage_call_id         BIGINT UNSIGNED NULL,
  reason                VARCHAR(100) NOT NULL,
  notes                 VARCHAR(500) NULL,
  external_reference    VARCHAR(191) NULL,
  actor_user_id         INT NULL,
  actor_name            VARCHAR(255) NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ai_ledger_idempotency (idempotency_key),
  INDEX idx_ai_ledger_business_created (business_id, created_at),
  INDEX idx_ai_ledger_call (usage_call_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Runtime issues (cross-organisation developer operations inbox)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS runtime_issues (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NULL,
  source                VARCHAR(64) NOT NULL,
  operation             VARCHAR(128) NOT NULL,
  severity              ENUM('warning','error','critical') NOT NULL DEFAULT 'error',
  status                ENUM('new','in_progress','fixed') NOT NULL DEFAULT 'new',
  title                 VARCHAR(255) NOT NULL,
  message               TEXT NOT NULL,
  fingerprint           CHAR(64) NOT NULL,
  first_seen_at         DATETIME(3) NOT NULL,
  last_seen_at          DATETIME(3) NOT NULL,
  occurrence_count      INT UNSIGNED NOT NULL DEFAULT 1,
  source_reference_type VARCHAR(64) NULL,
  source_reference_id   VARCHAR(191) NULL,
  latest_context        JSON NULL,
  assigned_to           INT NULL,
  resolution_notes      TEXT NULL,
  fixed_at              DATETIME(3) NULL,
  alert_pending         TINYINT(1) NOT NULL DEFAULT 0,
  last_alerted_at       DATETIME(3) NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_runtime_issue_fingerprint (fingerprint),
  INDEX idx_runtime_issue_status_seen (status, last_seen_at),
  INDEX idx_runtime_issue_business_seen (business_id, last_seen_at),
  INDEX idx_runtime_issue_source (source, operation)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS runtime_issue_events (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  issue_id    BIGINT NOT NULL,
  event_type  ENUM('occurred','status_changed','assigned','note') NOT NULL,
  severity    ENUM('warning','error','critical') NULL,
  message     TEXT NULL,
  stack_trace MEDIUMTEXT NULL,
  context     JSON NULL,
  actor_id    INT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_runtime_issue_event_issue (issue_id, created_at),
  CONSTRAINT fk_runtime_issue_events_issue
    FOREIGN KEY (issue_id) REFERENCES runtime_issues(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- business_info
-- From BusinessInfo!A:G: Timestamp, Brand Name, Brand URL,
--   Years in Business, Facebook Link, Instagram Link, Pinterest Link
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_info (
  business_id       VARCHAR(100) PRIMARY KEY,
  brand_name        VARCHAR(255),
  brand_url         VARCHAR(500),
  years_in_business VARCHAR(50),
  facebook_link     VARCHAR(500),
  instagram_link    VARCHAR(500),
  pinterest_link    VARCHAR(500),
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- brand_profile
-- From BrandProfile!A:U: Timestamp, Mission, UVP, Tone,
--   Demographics, Geo, Hero Products, Price Positioning,
--   Praises, Objections, Competitors, Market Gap, Logo URL,
--   Brand Colours, Shipping Policy, Connected Software,
--   Operations Summary, Returns Policy, Brand History,
--   Physical Branches, Loyalty Program
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS brand_profile (
  business_id        VARCHAR(100) PRIMARY KEY,
  mission            TEXT,
  uvp                TEXT,
  tone               TEXT,
  demographics       TEXT,
  geo                TEXT,
  hero_products      TEXT,
  price_positioning  TEXT,
  praises            TEXT,
  objections         TEXT,
  competitors        TEXT,
  market_gap         TEXT,
  logo_url           TEXT,
  brand_colours      TEXT,
  shipping_policy    TEXT,
  connected_software TEXT,
  operations_summary TEXT,
  returns_policy     TEXT,
  brand_history      TEXT,
  physical_branches  TEXT,
  loyalty_program    TEXT,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- branches
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  business_id    VARCHAR(100) NOT NULL,
  cin7_id        INT          NOT NULL,
  name           VARCHAR(255) NOT NULL,
  is_active      TINYINT(1)   DEFAULT 1,
  last_synced_at DATETIME,
  PRIMARY KEY (business_id, cin7_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  business_id    VARCHAR(100) NOT NULL,
  cin7_id        INT          NOT NULL,
  name           VARCHAR(255),
  contact_name   VARCHAR(255),
  email          VARCHAR(255),
  phone          VARCHAR(100),
  country        VARCHAR(100),
  lead_time_days INT,
  last_synced_at DATETIME,
  PRIMARY KEY (business_id, cin7_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- products  (populated by sync — not pre-migrated)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  business_id        VARCHAR(100)  NOT NULL,
  cin7_id            INT           NOT NULL,
  option_id          INT,
  code               VARCHAR(100),
  style_code         VARCHAR(100),
  barcode            VARCHAR(100),
  name               VARCHAR(500),
  brand              VARCHAR(255),
  supplier_id        INT,
  option_label       VARCHAR(255),
  online             TINYINT(1)    DEFAULT 0,
  pack_size          INT           DEFAULT 1,
  cost               DECIMAL(10,2),
  retail_price       DECIMAL(10,2),
  volume             DECIMAL(10,4),
  created_date       DATE,
  last_synced_at     DATETIME,
  global_soh         INT           DEFAULT 0,
  global_available   INT           DEFAULT 0,
  global_incoming    INT           DEFAULT 0,
  sales_qty_7d       INT           DEFAULT 0,
  sales_qty_90d      INT           DEFAULT 0,
  sales_qty_180d     INT           DEFAULT 0,
  sales_qty_12m      INT           DEFAULT 0,
  sales_revenue_7d   DECIMAL(12,2) DEFAULT 0,
  sales_revenue_90d  DECIMAL(12,2) DEFAULT 0,
  sales_revenue_180d DECIMAL(12,2) DEFAULT 0,
  sales_revenue_12m  DECIMAL(12,2) DEFAULT 0,
  PRIMARY KEY (business_id, cin7_id),
  INDEX idx_code      (business_id, code),
  INDEX idx_brand     (business_id, brand),
  INDEX idx_option_id (business_id, option_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- stock  (populated by sync — not pre-migrated)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock (
  business_id       VARCHAR(100) NOT NULL,
  product_option_id INT          NOT NULL,
  branch_id         INT          NOT NULL,
  branch_name       VARCHAR(255),
  code              VARCHAR(100),
  name              VARCHAR(500),
  soh               INT          DEFAULT 0,
  available         INT          DEFAULT 0,
  incoming          INT          DEFAULT 0,
  reorder_point     INT          DEFAULT 0,
  reorder_qty       INT          DEFAULT 0,
  last_synced_at    DATETIME,
  PRIMARY KEY (business_id, product_option_id, branch_id),
  INDEX idx_branch (business_id, branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- sales  (populated by sync — not pre-migrated)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id       VARCHAR(100) NOT NULL,
  order_id          VARCHAR(100) NOT NULL,
  reference         VARCHAR(100),
  invoice_date      DATE         NOT NULL,
  branch_id         INT,
  member_id         INT,
  product_option_id INT,
  code              VARCHAR(100),
  name              VARCHAR(500),
  qty               DECIMAL(10,3),
  unit_price        DECIMAL(10,2),
  line_total        DECIMAL(12,2),
  source            VARCHAR(100),
  status            VARCHAR(100),
  stage             VARCHAR(100),
  INDEX idx_date         (business_id, invoice_date),
  INDEX idx_branch_date  (business_id, branch_id, invoice_date),
  INDEX idx_product_date (business_id, product_option_id, invoice_date),
  UNIQUE KEY uq_line     (business_id, order_id, product_option_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- calc_reports  (replaces 11 CalcReport_* tabs)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS calc_reports (
  business_id  VARCHAR(100) NOT NULL,
  report_type  VARCHAR(100) NOT NULL,
  generated_at DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  row_count    INT          DEFAULT 0,
  data         JSON,
  PRIMARY KEY (business_id, report_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- yearly_revenue
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS yearly_revenue (
  business_id VARCHAR(100)  NOT NULL,
  year        SMALLINT      NOT NULL,
  branch      VARCHAR(255)  NOT NULL,
  brand       VARCHAR(255)  NOT NULL,
  qty         INT           DEFAULT 0,
  revenue     DECIMAL(14,2) DEFAULT 0,
  PRIMARY KEY (business_id, year, branch, brand),
  INDEX idx_year (business_id, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- chats  (AI conversation history)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS chats (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  ts          DATETIME     NOT NULL,
  role        VARCHAR(50),
  summary     TEXT,
  sentiment   VARCHAR(50),
  tags        JSON,
  INDEX idx_business_ts (business_id, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- shopify_products
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS shopify_products (
  business_id      VARCHAR(100) NOT NULL,
  shopify_id       BIGINT       NOT NULL,
  variant_id       BIGINT       NOT NULL,
  title            VARCHAR(500),
  vendor           VARCHAR(255),
  product_type     VARCHAR(255),
  handle           VARCHAR(500),
  status           VARCHAR(50),
  tags             TEXT,
  body_html        TEXT,
  sku              VARCHAR(100),
  price            DECIMAL(10,2),
  compare_at_price DECIMAL(10,2),
  inventory_qty    INT,
  last_synced_at   DATETIME,
  PRIMARY KEY (business_id, shopify_id, variant_id),
  INDEX idx_sku (business_id, sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- shopify_orders
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS shopify_orders (
  business_id        VARCHAR(100) NOT NULL,
  order_id           BIGINT       NOT NULL,
  order_number       VARCHAR(50),
  created_at         DATETIME,
  financial_status   VARCHAR(50),
  fulfillment_status VARCHAR(50),
  total_price        DECIMAL(12,2),
  customer_email     VARCHAR(255),
  line_items         JSON,
  last_synced_at     DATETIME,
  PRIMARY KEY (business_id, order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- marketing_data  (replaces GAds_*, Meta_*, Analytics_* tabs)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing_data (
  business_id    VARCHAR(100) NOT NULL,
  platform       VARCHAR(50)  NOT NULL,
  account_id     VARCHAR(100) NOT NULL,
  record_date    DATE         NOT NULL,
  entity_type    VARCHAR(100) NOT NULL,
  entity_id      VARCHAR(100) NOT NULL DEFAULT '',
  entity_name    VARCHAR(500),
  metrics        JSON,
  last_synced_at DATETIME,
  PRIMARY KEY (business_id, platform, account_id, record_date, entity_type, entity_id),
  INDEX idx_platform_date (business_id, platform, record_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Foresight strategy and recommendation control plane
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS foresight_strategy_versions (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id     VARCHAR(100) NOT NULL,
  version         INT NOT NULL,
  parent_id       BIGINT,
  strategy_json   JSON NOT NULL,
  markdown_text   LONGTEXT NOT NULL,
  authored_by     INT,
  change_reason   VARCHAR(500),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_strategy_version (business_id, version),
  INDEX idx_foresight_strategy_latest (business_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_planning_threads (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_type           VARCHAR(32) NOT NULL,
  state                 VARCHAR(32) NOT NULL DEFAULT 'discovering',
  title                 VARCHAR(255) NOT NULL,
  strategy_version_id   BIGINT,
  created_by            INT NOT NULL,
  revision              INT NOT NULL DEFAULT 1,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_foresight_planning_thread_inbox (business_id, state, updated_at),
  INDEX idx_foresight_planning_thread_type (business_id, thread_type, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_planning_messages (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  actor_type            VARCHAR(32) NOT NULL,
  actor_user_id         INT,
  model_id              VARCHAR(100),
  prompt_version        VARCHAR(100),
  content               LONGTEXT NOT NULL,
  message_json          JSON,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_foresight_planning_message_thread (business_id, thread_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_planning_tool_calls (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  message_id            BIGINT,
  tool_name             VARCHAR(100) NOT NULL,
  arguments_json        JSON NOT NULL,
  result_json           JSON,
  result_hash           VARCHAR(64),
  fact_ids_json         JSON,
  state                 VARCHAR(32) NOT NULL DEFAULT 'running',
  error_text            TEXT,
  duration_ms           INT,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at          DATETIME,
  INDEX idx_foresight_planning_tool_thread (business_id, thread_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_plan_versions (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  version               INT NOT NULL,
  parent_id             BIGINT,
  state                 VARCHAR(32) NOT NULL DEFAULT 'drafting',
  schema_version        INT NOT NULL,
  plan_json             JSON NOT NULL,
  markdown_text         LONGTEXT NOT NULL,
  plan_hash             VARCHAR(64) NOT NULL,
  model_id              VARCHAR(100),
  prompt_version        VARCHAR(100),
  tool_manifest_version VARCHAR(100),
  authored_by           INT,
  change_reason         VARCHAR(500),
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_plan_version (business_id, thread_id, version),
  UNIQUE KEY uq_foresight_plan_hash (business_id, thread_id, plan_hash),
  INDEX idx_foresight_plan_latest (business_id, thread_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_plan_links (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  plan_version_id       BIGINT,
  link_type             VARCHAR(32) NOT NULL,
  link_id               VARCHAR(255) NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_plan_link (business_id, thread_id, link_type, link_id),
  INDEX idx_foresight_plan_link_target (business_id, link_type, link_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_plan_validations (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  plan_version_id       BIGINT NOT NULL,
  plan_hash             VARCHAR(64) NOT NULL,
  state                 VARCHAR(32) NOT NULL,
  findings_json         JSON NOT NULL,
  validator_version     VARCHAR(100) NOT NULL,
  validated_by          INT,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_foresight_plan_validation (business_id, plan_version_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_plan_review_events (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  plan_version_id       BIGINT NOT NULL,
  plan_hash             VARCHAR(64) NOT NULL,
  action                VARCHAR(32) NOT NULL,
  actor_id              INT NOT NULL,
  note                  VARCHAR(1000),
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_foresight_plan_review_thread (business_id, thread_id, id),
  INDEX idx_foresight_plan_review_version (business_id, plan_version_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_deliverable_versions (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  plan_version_id       BIGINT NOT NULL,
  plan_hash             VARCHAR(64) NOT NULL,
  version               INT NOT NULL,
  parent_id             BIGINT,
  schema_version        INT NOT NULL,
  document_json         JSON NOT NULL,
  markdown_text         LONGTEXT NOT NULL,
  document_hash         VARCHAR(64) NOT NULL,
  model_id              VARCHAR(100),
  prompt_version        VARCHAR(100),
  authored_by           INT,
  change_reason         VARCHAR(1000),
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_deliverable_version (business_id, thread_id, version),
  UNIQUE KEY uq_foresight_deliverable_hash (business_id, thread_id, document_hash),
  INDEX idx_foresight_deliverable_plan (business_id, plan_version_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_deliverable_review_events (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  deliverable_version_id BIGINT NOT NULL,
  document_hash         VARCHAR(64) NOT NULL,
  action                VARCHAR(32) NOT NULL,
  actor_id              INT NOT NULL,
  note                  VARCHAR(1000),
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_foresight_deliverable_review_thread (business_id, thread_id, id),
  INDEX idx_foresight_deliverable_review_version (business_id, deliverable_version_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_campaign_activations (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  plan_version_id       BIGINT NOT NULL,
  plan_hash             VARCHAR(64) NOT NULL,
  deliverable_version_id BIGINT NOT NULL,
  document_hash         VARCHAR(64) NOT NULL,
  activated_on          DATE NOT NULL,
  channels_json         JSON NOT NULL,
  destination_url       VARCHAR(2000),
  utm_json              JSON NOT NULL,
  asset_ids_json        JSON NOT NULL,
  published_details     TEXT NOT NULL,
  deviations_text       TEXT,
  operator_note         TEXT NOT NULL,
  horizon_days          INT NOT NULL,
  baseline_start        DATE NOT NULL,
  baseline_end          DATE NOT NULL,
  followup_start        DATE NOT NULL,
  followup_end          DATE NOT NULL,
  first_assessment_date DATE NOT NULL,
  activated_by          INT NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_campaign_activation_deliverable (business_id, deliverable_version_id),
  INDEX idx_foresight_campaign_activation_schedule (business_id, first_assessment_date, id),
  INDEX idx_foresight_campaign_activation_thread (business_id, thread_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_campaign_activation_outcomes (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  activation_id         BIGINT NOT NULL,
  thread_id             BIGINT NOT NULL,
  deliverable_version_id BIGINT NOT NULL,
  document_hash         VARCHAR(64) NOT NULL,
  horizon_days          INT NOT NULL,
  baseline_start        DATE NOT NULL,
  baseline_end          DATE NOT NULL,
  followup_start        DATE NOT NULL,
  followup_end          DATE NOT NULL,
  direction             VARCHAR(32) NOT NULL,
  primary_metric        VARCHAR(100),
  baseline_value        DECIMAL(18,4),
  followup_value        DECIMAL(18,4),
  assessment_json       JSON NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_campaign_activation_outcome (business_id, activation_id, horizon_days),
  INDEX idx_foresight_campaign_outcome_thread (business_id, thread_id, id),
  INDEX idx_foresight_campaign_outcome_created (business_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_campaign_lesson_versions (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  outcome_id            BIGINT NOT NULL,
  activation_id         BIGINT NOT NULL,
  version               INT NOT NULL,
  parent_id             BIGINT,
  schema_version        INT NOT NULL,
  lesson_json           JSON NOT NULL,
  lesson_hash           VARCHAR(64) NOT NULL,
  model_id              VARCHAR(100),
  prompt_version        VARCHAR(100),
  authored_by           INT NOT NULL,
  change_reason         VARCHAR(1000),
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_campaign_lesson_version (business_id, outcome_id, version),
  UNIQUE KEY uq_foresight_campaign_lesson_hash (business_id, outcome_id, lesson_hash),
  INDEX idx_foresight_campaign_lesson_thread (business_id, thread_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_campaign_lesson_review_events (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  lesson_version_id     BIGINT NOT NULL,
  lesson_hash           VARCHAR(64) NOT NULL,
  action                VARCHAR(32) NOT NULL,
  actor_id              INT NOT NULL,
  note                  VARCHAR(1000),
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_foresight_campaign_lesson_review_thread (business_id, thread_id, id),
  INDEX idx_foresight_campaign_lesson_review_version (business_id, lesson_version_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_campaign_experiment_versions (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  lesson_version_id     BIGINT NOT NULL,
  lesson_hash           VARCHAR(64) NOT NULL,
  version               INT NOT NULL,
  parent_id             BIGINT,
  schema_version        INT NOT NULL,
  experiment_json       JSON NOT NULL,
  experiment_hash       VARCHAR(64) NOT NULL,
  model_id              VARCHAR(100),
  prompt_version        VARCHAR(100),
  authored_by           INT NOT NULL,
  change_reason         VARCHAR(1000),
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_campaign_experiment_version (business_id, lesson_version_id, version),
  UNIQUE KEY uq_foresight_campaign_experiment_hash (business_id, lesson_version_id, experiment_hash),
  INDEX idx_foresight_campaign_experiment_thread (business_id, thread_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_campaign_experiment_review_events (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  experiment_version_id BIGINT NOT NULL,
  experiment_hash       VARCHAR(64) NOT NULL,
  action                VARCHAR(32) NOT NULL,
  actor_id              INT NOT NULL,
  note                  VARCHAR(1000),
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_foresight_campaign_experiment_review_thread (business_id, thread_id, id),
  INDEX idx_foresight_campaign_experiment_review_version (business_id, experiment_version_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_meta_experiment_launch_package_confirmations (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  experiment_version_id BIGINT NOT NULL,
  experiment_hash       VARCHAR(64) NOT NULL,
  meta_account_id       VARCHAR(255) NOT NULL,
  control_campaign_id   VARCHAR(255) NOT NULL,
  treatment_campaign_id VARCHAR(255) NOT NULL,
  package_fingerprint   VARCHAR(64) NOT NULL,
  confirmed_by          INT NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_meta_experiment_package (business_id, experiment_version_id),
  INDEX idx_foresight_meta_experiment_package_thread (business_id, thread_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_campaign_experiment_executions (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  experiment_version_id BIGINT NOT NULL,
  package_confirmation_id BIGINT NOT NULL,
  package_fingerprint   VARCHAR(64) NOT NULL,
  execution_fingerprint VARCHAR(64) NOT NULL,
  idempotency_key       VARCHAR(128) NOT NULL,
  execution_kind        VARCHAR(32) NOT NULL,
  state                 VARCHAR(32) NOT NULL,
  meta_study_id         VARCHAR(255),
  before_json           JSON NOT NULL,
  request_json          JSON NOT NULL,
  response_json         JSON,
  after_json            JSON,
  error_text            TEXT,
  compensates_execution_id BIGINT,
  actor_id              INT NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at          DATETIME,
  UNIQUE KEY uq_foresight_campaign_experiment_execution (business_id, experiment_version_id, execution_kind),
  UNIQUE KEY uq_foresight_campaign_experiment_execution_key (business_id, idempotency_key),
  INDEX idx_foresight_campaign_experiment_execution_thread (business_id, thread_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_campaign_experiment_launches (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  experiment_version_id BIGINT NOT NULL,
  experiment_hash       VARCHAR(64) NOT NULL,
  launched_on           DATE NOT NULL,
  scheduled_end_on      DATE NOT NULL,
  channel               VARCHAR(32) NOT NULL,
  control_external_id   VARCHAR(255) NOT NULL,
  treatment_external_id VARCHAR(255) NOT NULL,
  control_allocation    DECIMAL(5,2) NOT NULL,
  treatment_allocation  DECIMAL(5,2) NOT NULL,
  target_sample_per_variant INT NOT NULL,
  random_assignment_attested TINYINT(1) NOT NULL,
  single_variable_attested TINYINT(1) NOT NULL,
  implementation_details TEXT NOT NULL,
  deviations_text       TEXT,
  operator_note         TEXT NOT NULL,
  launched_by           INT NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_campaign_experiment_launch (business_id, experiment_version_id),
  INDEX idx_foresight_campaign_experiment_launch_thread (business_id, thread_id, id),
  INDEX idx_foresight_campaign_experiment_launch_schedule (business_id, scheduled_end_on, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_campaign_experiment_results (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  experiment_version_id BIGINT NOT NULL,
  experiment_hash       VARCHAR(64) NOT NULL,
  launch_id             BIGINT NOT NULL,
  formula_version       VARCHAR(100) NOT NULL,
  observation_json      JSON NOT NULL,
  assessment_json       JSON NOT NULL,
  status                VARCHAR(32) NOT NULL,
  primary_metric        VARCHAR(100) NOT NULL,
  control_value         DECIMAL(20,8),
  treatment_value       DECIMAL(20,8),
  p_value               DECIMAL(20,12),
  evaluated_by          INT NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_campaign_experiment_result (business_id, launch_id),
  INDEX idx_foresight_campaign_experiment_result_thread (business_id, thread_id, id),
  INDEX idx_foresight_campaign_experiment_result_status (business_id, status, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_campaign_experiment_result_review_events (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  result_id             BIGINT NOT NULL,
  experiment_version_id BIGINT NOT NULL,
  experiment_hash       VARCHAR(64) NOT NULL,
  launch_id             BIGINT NOT NULL,
  action                VARCHAR(32) NOT NULL,
  actor_id              INT NOT NULL,
  note                  VARCHAR(1000),
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_foresight_experiment_result_review_thread (business_id, thread_id, id),
  INDEX idx_foresight_experiment_result_review_result (business_id, result_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_recommendations (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  fingerprint           VARCHAR(128) NOT NULL,
  state                 VARCHAR(32) NOT NULL DEFAULT 'shadow',
  channel               VARCHAR(32) NOT NULL,
  subject_type          VARCHAR(64) NOT NULL,
  subject_id            VARCHAR(255) NOT NULL,
  rule_id               VARCHAR(100) NOT NULL,
  policy_version        INT,
  formula_version       VARCHAR(100),
  evidence_json         JSON NOT NULL,
  proposed_action_json  JSON,
  proposal_hash         VARCHAR(64),
  confidence            DECIMAL(6,5),
  expected_impact_low   DECIMAL(16,4),
  expected_impact_high  DECIMAL(16,4),
  expires_at            DATETIME,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_recommendation (business_id, fingerprint),
  INDEX idx_foresight_recommendation_inbox (business_id, state, expires_at),
  INDEX idx_foresight_recommendation_subject (business_id, channel, subject_type, subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_approvals (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id        VARCHAR(100) NOT NULL,
  recommendation_id  BIGINT NOT NULL,
  decision           VARCHAR(32) NOT NULL,
  proposal_hash      VARCHAR(64),
  decided_by         INT NOT NULL,
  reason_code        VARCHAR(64),
  note               VARCHAR(1000),
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_foresight_approval_recommendation (business_id, recommendation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_recommendation_events (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id        VARCHAR(100) NOT NULL,
  recommendation_id  BIGINT NOT NULL,
  from_state         VARCHAR(32) NOT NULL,
  to_state           VARCHAR(32) NOT NULL,
  proposal_hash      VARCHAR(64),
  actor_id           INT NOT NULL,
  reason_code        VARCHAR(64),
  note               VARCHAR(1000),
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_foresight_recommendation_event (business_id, recommendation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_recommendation_implementations (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id        VARCHAR(100) NOT NULL,
  recommendation_id  BIGINT NOT NULL,
  approval_id        BIGINT NOT NULL,
  proposal_hash      VARCHAR(64) NOT NULL,
  method             VARCHAR(32) NOT NULL DEFAULT 'manual_external',
  implemented_on     DATE NOT NULL,
  implemented_by     INT NOT NULL,
  note               VARCHAR(1000) NOT NULL,
  preview_json       JSON NOT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_recommendation_implementation (business_id, recommendation_id),
  INDEX idx_foresight_implementation_activity (business_id, implemented_on, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_recommendation_outcomes (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id        VARCHAR(100) NOT NULL,
  recommendation_id  BIGINT NOT NULL,
  decision           VARCHAR(32) NOT NULL,
  horizon_days       INT NOT NULL,
  baseline_start     DATE NOT NULL,
  baseline_end       DATE NOT NULL,
  followup_start     DATE NOT NULL,
  followup_end       DATE NOT NULL,
  direction          VARCHAR(32) NOT NULL,
  condition_state    VARCHAR(32) NOT NULL,
  primary_metric     VARCHAR(100),
  baseline_value     DECIMAL(20,6),
  followup_value     DECIMAL(20,6),
  assessment_json    JSON NOT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_recommendation_outcome (business_id, recommendation_id, horizon_days),
  INDEX idx_foresight_outcome_activity (business_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_executions (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  recommendation_id     BIGINT NOT NULL,
  approval_id           BIGINT NOT NULL,
  idempotency_key       VARCHAR(128) NOT NULL,
  state                 VARCHAR(32) NOT NULL,
  before_json           JSON,
  request_json          JSON NOT NULL,
  response_json         JSON,
  after_json            JSON,
  error_text            TEXT,
  compensates_execution_id BIGINT,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at          DATETIME,
  UNIQUE KEY uq_foresight_execution (business_id, idempotency_key),
  INDEX idx_foresight_execution_activity (business_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_digest_runs (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id       VARCHAR(100) NOT NULL,
  digest_type       VARCHAR(32) NOT NULL DEFAULT 'daily_operations',
  digest_date       DATE NOT NULL,
  snapshot_json     JSON NOT NULL,
  generated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_digest_run (business_id, digest_type, digest_date),
  INDEX idx_foresight_digest_activity (business_id, generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_sync_runs (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id       VARCHAR(100) NOT NULL,
  requested_sources JSON NOT NULL,
  state             VARCHAR(32) NOT NULL DEFAULT 'running',
  window_start      DATE NOT NULL,
  window_end        DATE NOT NULL,
  started_by        INT,
  successful_tabs   INT NOT NULL DEFAULT 0,
  failed_tabs       INT NOT NULL DEFAULT 0,
  error_text        TEXT,
  started_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at      DATETIME,
  INDEX idx_foresight_sync_runs_business (business_id, started_at),
  INDEX idx_foresight_sync_runs_state (business_id, state, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_sync_tabs (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id       BIGINT NOT NULL,
  business_id  VARCHAR(100) NOT NULL,
  source       VARCHAR(32) NOT NULL,
  account_id   VARCHAR(255) NOT NULL DEFAULT '',
  tab_key      VARCHAR(100) NOT NULL,
  label        VARCHAR(255) NOT NULL,
  state        VARCHAR(32) NOT NULL,
  window_start DATE,
  window_end   DATE,
  row_count    INT NOT NULL DEFAULT 0,
  metadata_json JSON,
  error_text   TEXT,
  completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_sync_tab (run_id, source, tab_key),
  INDEX idx_foresight_sync_tabs_business (business_id, completed_at),
  INDEX idx_foresight_sync_tabs_run (run_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_marketing_observations (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id             BIGINT NOT NULL,
  business_id        VARCHAR(100) NOT NULL,
  source             VARCHAR(32) NOT NULL,
  account_id         VARCHAR(255) NOT NULL,
  metric_date        DATE NOT NULL,
  spend              DECIMAL(16,4) NOT NULL DEFAULT 0,
  impressions        BIGINT NOT NULL DEFAULT 0,
  clicks             BIGINT NOT NULL DEFAULT 0,
  conversions        DECIMAL(16,4) NOT NULL DEFAULT 0,
  attributed_revenue DECIMAL(16,4) NOT NULL DEFAULT 0,
  currency_code      VARCHAR(8),
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_marketing_observation (run_id, source, account_id, metric_date),
  INDEX idx_foresight_marketing_observation_trend (business_id, source, metric_date),
  INDEX idx_foresight_marketing_observation_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_marketing_entity_observations (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id             BIGINT NOT NULL,
  business_id        VARCHAR(100) NOT NULL,
  source             VARCHAR(32) NOT NULL,
  account_id         VARCHAR(255) NOT NULL,
  metric_date        DATE NOT NULL,
  entity_type        VARCHAR(32) NOT NULL,
  entity_id          VARCHAR(255) NOT NULL,
  entity_name        VARCHAR(500) NOT NULL,
  parent_entity_id   VARCHAR(255),
  parent_entity_name VARCHAR(500),
  spend              DECIMAL(16,4) NOT NULL DEFAULT 0,
  impressions        BIGINT NOT NULL DEFAULT 0,
  clicks             BIGINT NOT NULL DEFAULT 0,
  conversions        DECIMAL(16,4) NOT NULL DEFAULT 0,
  attributed_revenue DECIMAL(16,4) NOT NULL DEFAULT 0,
  currency_code      VARCHAR(8),
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_marketing_entity_observation
    (run_id, source, account_id, metric_date, entity_type, entity_id),
  INDEX idx_foresight_marketing_entity_trend
    (business_id, source, entity_type, metric_date),
  INDEX idx_foresight_marketing_entity_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_creatives (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  source                VARCHAR(32) NOT NULL,
  account_id            VARCHAR(255) NOT NULL,
  external_id           VARCHAR(255) NOT NULL,
  creative_kind         VARCHAR(32) NOT NULL,
  name                  VARCHAR(500) NOT NULL,
  format                VARCHAR(100),
  status                VARCHAR(64),
  copy_json             JSON,
  media_json            JSON,
  first_seen_on         DATE NOT NULL,
  last_seen_on          DATE NOT NULL,
  ended_on              DATE,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_creative_identity (business_id, source, account_id, creative_kind, external_id),
  INDEX idx_foresight_creative_seen (business_id, last_seen_on, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_creative_entity_links (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  creative_id           BIGINT NOT NULL,
  source                VARCHAR(32) NOT NULL,
  account_id            VARCHAR(255) NOT NULL,
  entity_type           VARCHAR(32) NOT NULL,
  entity_id             VARCHAR(255) NOT NULL,
  entity_name           VARCHAR(500),
  first_seen_on         DATE NOT NULL,
  last_seen_on          DATE NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_creative_entity_link (business_id, creative_id, entity_type, entity_id),
  INDEX idx_foresight_creative_entity (business_id, source, account_id, entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_creative_daily_metrics (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id                BIGINT NOT NULL,
  business_id           VARCHAR(100) NOT NULL,
  creative_id           BIGINT NOT NULL,
  source                VARCHAR(32) NOT NULL,
  account_id            VARCHAR(255) NOT NULL,
  metric_date           DATE NOT NULL,
  impressions           BIGINT NOT NULL DEFAULT 0,
  spend                 DECIMAL(16,4) NOT NULL DEFAULT 0,
  clicks                BIGINT NOT NULL DEFAULT 0,
  conversions           DECIMAL(16,4) NOT NULL DEFAULT 0,
  attributed_revenue    DECIMAL(16,4) NOT NULL DEFAULT 0,
  reach                 BIGINT,
  frequency             DECIMAL(12,6),
  video_views            BIGINT,
  currency_code         VARCHAR(10),
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_creative_daily (run_id, business_id, creative_id, metric_date),
  INDEX idx_foresight_creative_daily_latest (business_id, source, account_id, creative_id, metric_date, run_id),
  INDEX idx_foresight_creative_daily_retention (business_id, metric_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_creative_assessments (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  creative_id           BIGINT NOT NULL,
  assessment_hash       VARCHAR(64) NOT NULL,
  creative_snapshot_hash VARCHAR(64) NOT NULL,
  brand_profile_hash    VARCHAR(64) NOT NULL,
  evidence_mode         VARCHAR(32) NOT NULL,
  model_id              VARCHAR(100) NOT NULL,
  prompt_version        VARCHAR(100) NOT NULL,
  prompt_hash           VARCHAR(64) NOT NULL,
  assessment_json       JSON NOT NULL,
  assessed_by           INT NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_creative_assessment (business_id, creative_id, assessment_hash),
  INDEX idx_foresight_creative_assessment_latest (business_id, creative_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_creative_brief_versions (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  creative_id           BIGINT NOT NULL,
  assessment_id         BIGINT NOT NULL,
  diagnostics_through   DATE NOT NULL,
  version               INT NOT NULL,
  parent_id             BIGINT,
  schema_version        INT NOT NULL,
  document_json         JSON NOT NULL,
  markdown_text         LONGTEXT NOT NULL,
  document_hash         VARCHAR(64) NOT NULL,
  model_id              VARCHAR(100),
  prompt_version        VARCHAR(100),
  prompt_hash           VARCHAR(64),
  authored_by           INT,
  change_reason         VARCHAR(500),
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_creative_brief_version (business_id, thread_id, version),
  UNIQUE KEY uq_foresight_creative_brief_hash (business_id, thread_id, document_hash),
  INDEX idx_foresight_creative_brief_latest (business_id, creative_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_creative_brief_review_events (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(100) NOT NULL,
  thread_id             BIGINT NOT NULL,
  brief_version_id      BIGINT NOT NULL,
  document_hash         VARCHAR(64) NOT NULL,
  action                ENUM('accepted','rejected','revision_requested') NOT NULL,
  actor_id              INT NOT NULL,
  note                  VARCHAR(1000),
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_foresight_creative_brief_review_latest (business_id, thread_id, id),
  INDEX idx_foresight_creative_brief_review_version (business_id, brief_version_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foresight_commerce_observations (
  id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id                  BIGINT NOT NULL,
  business_id             VARCHAR(100) NOT NULL,
  metric_date             DATE NOT NULL,
  channel                 VARCHAR(32) NOT NULL,
  sales_inc_tax           DECIMAL(16,4) NOT NULL DEFAULT 0,
  sales_tax               DECIMAL(16,4) NOT NULL DEFAULT 0,
  returns_inc_tax         DECIMAL(16,4) NOT NULL DEFAULT 0,
  returns_tax             DECIMAL(16,4) NOT NULL DEFAULT 0,
  sales_cogs              DECIMAL(16,4) NOT NULL DEFAULT 0,
  returned_cogs           DECIMAL(16,4) NOT NULL DEFAULT 0,
  order_count             INT NOT NULL DEFAULT 0,
  return_count            INT NOT NULL DEFAULT 0,
  cost_line_count         INT NOT NULL DEFAULT 0,
  missing_cost_line_count INT NOT NULL DEFAULT 0,
  cost_basis              VARCHAR(32) NOT NULL,
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_foresight_commerce_observation (run_id, channel, metric_date),
  INDEX idx_foresight_commerce_observation_trend (business_id, channel, metric_date),
  INDEX idx_foresight_commerce_observation_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- bulk_edit_history  (replaces History tab)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS bulk_edit_history (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL,
  ts          DATETIME     DEFAULT CURRENT_TIMESTAMP,
  user_email  VARCHAR(255),
  action      VARCHAR(100),
  changes     JSON,
  INDEX idx_business_ts (business_id, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- product_schema  (replaces per-brand schema sheets)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_schema (
  business_id    VARCHAR(100) NOT NULL,
  brand          VARCHAR(255) NOT NULL,
  schema_version INT          DEFAULT 1,
  schema_data    JSON,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, brand)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- product_volumes  (volume ratings, replaces Products sheet "volume" col for IMS)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_volumes (
  business_id  VARCHAR(100) NOT NULL,
  source_id    VARCHAR(255) NOT NULL,   -- option_id (cin7) or variant_id (solvantis)
  volume       TINYINT      NOT NULL DEFAULT 0,
  updated_at   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- order_planner_drafts  (replaces Google Sheets "Draft Orders" spreadsheet)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_planner_drafts (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id          VARCHAR(100) NOT NULL,
  draft_name           VARCHAR(500),
  filter_type          VARCHAR(50),
  filter_value         VARCHAR(255),
  sales_window_days    INT,
  order_frequency_days INT,
  branch_id            VARCHAR(100),
  branch_name          VARCHAR(255),
  rows_json            LONGTEXT,
  cin7_po_id           VARCHAR(100),
  cin7_reference       VARCHAR(100),
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_business_id (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- public prospect sales assistant (shared main database)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_integration_offerings (
  id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug                     VARCHAR(100) NOT NULL,
  name                     VARCHAR(255) NOT NULL,
  category                 VARCHAR(100) NOT NULL,
  delivery_mode            ENUM('native','on_demand','beta','not_offered') NOT NULL,
  public_summary           TEXT NOT NULL,
  example_providers_json   JSON NOT NULL,
  supported_workflows_json JSON NOT NULL,
  qualification_questions_json JSON NOT NULL,
  is_enabled               TINYINT(1) NOT NULL DEFAULT 1,
  internal_notes           TEXT NULL,
  created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sales_integration_offering_slug (slug),
  INDEX idx_sales_integration_offering_public (is_enabled, delivery_mode, category, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prospect_conversations (
  id                  CHAR(36) PRIMARY KEY,
  session_id_hash     CHAR(64) NOT NULL,
  status              ENUM('active','converted','abandoned','closed','blocked') NOT NULL DEFAULT 'active',
  source_path         VARCHAR(500) NULL,
  attribution_json    JSON NULL,
  last_user_prompt    LONGTEXT NULL,
  message_count       INT UNSIGNED NOT NULL DEFAULT 0,
  last_message_at     DATETIME(3) NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_prospect_conversation_session (session_id_hash, updated_at),
  INDEX idx_prospect_conversation_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prospect_messages (
  id                  CHAR(36) PRIMARY KEY,
  conversation_id     CHAR(36) NOT NULL,
  role                ENUM('user','assistant') NOT NULL,
  content             LONGTEXT NOT NULL,
  model_name          VARCHAR(100) NULL,
  prompt_version      VARCHAR(100) NULL,
  metadata_json       JSON NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_prospect_message_conversation (conversation_id, created_at, id),
  CONSTRAINT fk_prospect_message_conversation FOREIGN KEY (conversation_id)
    REFERENCES prospect_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_integration_events (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  idempotency_key     VARCHAR(191) NOT NULL,
  offering_id         BIGINT UNSIGNED NULL,
  conversation_id     CHAR(36) NULL,
  event_type          VARCHAR(64) NOT NULL,
  provider_name       VARCHAR(191) NULL,
  event_data_json     JSON NULL,
  occurred_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sales_integration_event_idempotency (idempotency_key),
  INDEX idx_sales_integration_event_offering (offering_id, occurred_at),
  INDEX idx_sales_integration_event_conversation (conversation_id, occurred_at),
  CONSTRAINT fk_sales_integration_event_offering FOREIGN KEY (offering_id)
    REFERENCES sales_integration_offerings(id) ON DELETE SET NULL,
  CONSTRAINT fk_sales_integration_event_conversation FOREIGN KEY (conversation_id)
    REFERENCES prospect_conversations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prospect_events (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  idempotency_key     VARCHAR(191) NOT NULL,
  conversation_id     CHAR(36) NULL,
  event_type          VARCHAR(64) NOT NULL,
  event_data_json     JSON NULL,
  occurred_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_prospect_event_idempotency (idempotency_key),
  INDEX idx_prospect_event_conversation (conversation_id, occurred_at),
  INDEX idx_prospect_event_type (event_type, occurred_at),
  CONSTRAINT fk_prospect_event_conversation FOREIGN KEY (conversation_id)
    REFERENCES prospect_conversations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prospect_leads (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  idempotency_key     VARCHAR(191) NOT NULL,
  conversation_id     CHAR(36) NULL,
  name                VARCHAR(255) NOT NULL,
  company             VARCHAR(255) NULL,
  email               VARCHAR(320) NULL,
  phone               VARCHAR(32) NULL,
  preferred_contact   ENUM('email','phone','sms') NOT NULL,
  consent_email       TINYINT(1) NOT NULL DEFAULT 0,
  consent_phone       TINYINT(1) NOT NULL DEFAULT 0,
  consent_sms         TINYINT(1) NOT NULL DEFAULT 0,
  consented_at        DATETIME(3) NOT NULL,
  locations           VARCHAR(100) NULL,
  current_systems     TEXT NULL,
  timeframe           VARCHAR(100) NULL,
  source_path         VARCHAR(500) NULL,
  status              ENUM('new','contacting','qualified','demo_booked','won','lost','spam') NOT NULL DEFAULT 'new',
  assigned_to         INT NULL,
  notes               TEXT NULL,
  loss_reason         TEXT NULL,
  first_contacted_at  DATETIME(3) NULL,
  followed_up_at      DATETIME(3) NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_prospect_lead_idempotency (idempotency_key),
  UNIQUE KEY uq_prospect_lead_conversation (conversation_id),
  INDEX idx_prospect_lead_status (status, created_at),
  INDEX idx_prospect_lead_assignee (assigned_to, status, created_at),
  CONSTRAINT fk_prospect_lead_conversation FOREIGN KEY (conversation_id)
    REFERENCES prospect_conversations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prospect_lead_events (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  idempotency_key     VARCHAR(191) NOT NULL,
  lead_id             BIGINT UNSIGNED NOT NULL,
  event_type          VARCHAR(64) NOT NULL,
  event_data_json     JSON NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_prospect_lead_event_idempotency (idempotency_key),
  INDEX idx_prospect_lead_event_lead (lead_id, created_at),
  CONSTRAINT fk_prospect_lead_event_lead FOREIGN KEY (lead_id)
    REFERENCES prospect_leads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prospect_demand_insights (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fingerprint         CHAR(64) NOT NULL,
  demand_type         ENUM('integration','feature','workflow','industry') NOT NULL,
  requested_name      VARCHAR(255) NOT NULL,
  requested_provider  VARCHAR(255) NULL,
  sample_prompt       TEXT NULL,
  first_seen_at       DATETIME(3) NOT NULL,
  last_seen_at        DATETIME(3) NOT NULL,
  occurrence_count    INT UNSIGNED NOT NULL DEFAULT 1,
  conversation_count  INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_prospect_demand_insight_fingerprint (fingerprint),
  INDEX idx_prospect_demand_insight_recent (demand_type, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prospect_rate_limits (
  rate_key_hash       CHAR(64) NOT NULL,
  operation           VARCHAR(64) NOT NULL,
  window_started_at   DATETIME(3) NOT NULL,
  request_count       INT UNSIGNED NOT NULL DEFAULT 1,
  expires_at          DATETIME(3) NOT NULL,
  PRIMARY KEY (rate_key_hash, operation, window_started_at),
  INDEX idx_prospect_rate_limit_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
