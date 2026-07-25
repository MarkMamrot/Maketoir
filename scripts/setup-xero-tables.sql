-- Xero Integration Tables
-- Run against the IMS database (or main marketoir DB depending on deployment)

-- Account code mappings: maps logical roles → Xero account codes per business
CREATE TABLE IF NOT EXISTS xero_account_mappings (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  business_id     VARCHAR(255)  NOT NULL,
  role_key        VARCHAR(50)   NOT NULL COMMENT 'inventory_asset | inventory_in_transit | cogs | sales_revenue | freight',
  xero_account_id VARCHAR(100)  DEFAULT NULL COMMENT 'Xero Account UUID',
  xero_account_code VARCHAR(20) DEFAULT NULL COMMENT 'Xero Account Code (e.g. 630)',
  xero_account_name VARCHAR(255) DEFAULT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_business_role (business_id, role_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tracking category mapping: links IMS locations/channels → Xero Tracking Category options
CREATE TABLE IF NOT EXISTS xero_tracking_mappings (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  business_id             VARCHAR(255)  NOT NULL,
  ims_location_id         INT           DEFAULT NULL COMMENT 'NULL for virtual channels (online, wholesale)',
  ims_channel             VARCHAR(50)   DEFAULT NULL COMMENT 'online | wholesale | NULL (for physical locations)',
  xero_tracking_category_id VARCHAR(100) NOT NULL COMMENT 'Xero Tracking Category UUID',
  xero_tracking_option_id   VARCHAR(100) NOT NULL COMMENT 'Xero Tracking Option UUID',
  xero_tracking_option_name VARCHAR(255) DEFAULT NULL,
  created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_business_location (business_id, ims_location_id, ims_channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sync log: records every Xero API interaction for auditing
CREATE TABLE IF NOT EXISTS xero_sync_log (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id     VARCHAR(255)  NOT NULL,
  sync_type       VARCHAR(30)   NOT NULL COMMENT 'po_bill | po_payment | so_invoice | pos_batch | online_batch | cogs_journal',
  reference_id    INT           DEFAULT NULL COMMENT 'ims_purchase_orders.id or ims_sales_orders.id etc',
  xero_id         VARCHAR(100)  DEFAULT NULL COMMENT 'Xero Invoice/Bill/Journal UUID returned',
  status          VARCHAR(20)   NOT NULL DEFAULT 'success' COMMENT 'success | error | skipped',
  detail          TEXT          DEFAULT NULL COMMENT 'Error message or summary',
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_business_type (business_id, sync_type),
  INDEX idx_business_created (business_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- COGS schedule configuration. Period calculation is performed in the stored
-- IANA timezone; reliable_from marks the first trustworthy live IMS ledger day.
CREATE TABLE IF NOT EXISTS xero_cogs_settings (
  business_id     VARCHAR(255) NOT NULL PRIMARY KEY,
  enabled         TINYINT(1)   NOT NULL DEFAULT 0,
  frequency       VARCHAR(20)  NOT NULL DEFAULT 'monthly',
  timezone        VARCHAR(100) NOT NULL DEFAULT 'Australia/Sydney',
  reliable_from   DATE         DEFAULT NULL,
  next_period_start DATE       DEFAULT NULL,
  next_run_at     DATETIME     DEFAULT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cogs_due (enabled, next_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per attempted accounting state. The unique target key prevents a
-- manual request and scheduler from posting the same period amount twice.
CREATE TABLE IF NOT EXISTS xero_cogs_journal_runs (
  id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id                 VARCHAR(255) NOT NULL,
  period_start                DATE         NOT NULL,
  period_end                  DATE         NOT NULL COMMENT 'Exclusive end date',
  journal_date                DATE         NOT NULL,
  frequency                   VARCHAR(20)  NOT NULL,
  run_kind                    VARCHAR(20)  NOT NULL DEFAULT 'original',
  target_amount               DECIMAL(14,2) NOT NULL,
  posted_delta                DECIMAL(14,2) NOT NULL,
  included_movement_count     INT          NOT NULL DEFAULT 0,
  missing_cost_movement_count INT          NOT NULL DEFAULT 0,
  zero_cost_movement_count    INT          NOT NULL DEFAULT 0,
  excluded_movement_count     INT          NOT NULL DEFAULT 0,
  orphaned_movement_count     INT          NOT NULL DEFAULT 0,
  status                      VARCHAR(20)  NOT NULL DEFAULT 'pending',
  xero_id                     VARCHAR(100) DEFAULT NULL,
  xero_state                  VARCHAR(20)  DEFAULT NULL,
  error_detail                TEXT         DEFAULT NULL,
  override_reason             TEXT         DEFAULT NULL,
  created_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cogs_target (business_id, period_start, period_end, target_amount),
  INDEX idx_cogs_period (business_id, period_start, period_end),
  INDEX idx_cogs_status (business_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- POS payment-method account mapping: maps each configured POS payment method
-- to a specific Xero account code for EOD invoice lines.
CREATE TABLE IF NOT EXISTS xero_pos_payment_mappings (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id       VARCHAR(255) NOT NULL,
  payment_method    VARCHAR(255) NOT NULL,
  xero_account_code VARCHAR(20)  NOT NULL,
  xero_account_name VARCHAR(255) DEFAULT NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_xero_pos_payment_method (business_id, payment_method),
  INDEX idx_xero_pos_payment_business (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
