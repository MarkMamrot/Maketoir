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
