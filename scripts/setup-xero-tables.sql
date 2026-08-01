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

-- Per-business PO/SO Xero lifecycle and payment-sync policy.
CREATE TABLE IF NOT EXISTS xero_document_policies (
  business_id                VARCHAR(255) NOT NULL PRIMARY KEY,
  po_approved_action         VARCHAR(20)  NOT NULL DEFAULT 'draft',
  po_completed_action        VARCHAR(20)  NOT NULL DEFAULT 'authorised',
  po_payment_sync_enabled    TINYINT(1)   NOT NULL DEFAULT 1,
  so_approved_action         VARCHAR(20)  NOT NULL DEFAULT 'draft',
  so_completed_action        VARCHAR(20)  NOT NULL DEFAULT 'authorised',
  so_payment_sync_enabled    TINYINT(1)   NOT NULL DEFAULT 1,
  manual_customer_cn_action  VARCHAR(20)  NOT NULL DEFAULT 'authorised',
  supplier_cn_action         VARCHAR(20)  NOT NULL DEFAULT 'draft',
  pos_batch_sync_enabled     TINYINT(1)   NOT NULL DEFAULT 1,
  pos_batch_payment_sync_enabled TINYINT(1) NOT NULL DEFAULT 1,
  online_batch_action        VARCHAR(20)  NOT NULL DEFAULT 'authorised',
  online_batch_payment_sync_enabled TINYINT(1) NOT NULL DEFAULT 1,
  shopify_payout_auto_post_enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
-- Legacy only: these rows represent REVENUE accounts and must never be treated
-- as clearing accounts or migrated into xero_pos_clearing_mappings.
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

-- POS settlement mapping: every location/payment-method pair routes its Xero
-- invoice payment into a dedicated bank or clearing account.
CREATE TABLE IF NOT EXISTS xero_pos_clearing_mappings (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id       VARCHAR(255) NOT NULL,
  ims_location_id   INT          NOT NULL,
  payment_method    VARCHAR(255) NOT NULL,
  xero_account_id   VARCHAR(100) NOT NULL,
  xero_account_code VARCHAR(20)  NOT NULL,
  xero_account_name VARCHAR(255) DEFAULT NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_xero_pos_clearing (business_id, ims_location_id, payment_method),
  INDEX idx_xero_pos_clearing_business (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Versioned accounting state for one tenant POS cash reconciliation. Rows that
-- already have Xero state but no plan remain legacy and are never reinterpreted.
CREATE TABLE IF NOT EXISTS xero_pos_cash_eod_actions (
  id                        BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id               VARCHAR(255) NOT NULL,
  eod_reconciliation_id     BIGINT       NOT NULL,
  accounting_version        INT          NOT NULL DEFAULT 2,
  expected_amount           DECIMAL(14,2) NOT NULL,
  counted_amount            DECIMAL(14,2) NOT NULL,
  opening_float             DECIMAL(14,2) NOT NULL,
  cash_rounding             DECIMAL(14,2) NOT NULL DEFAULT 0,
  sales_amount              DECIMAL(14,2) NOT NULL,
  till_variance             DECIMAL(14,2) NOT NULL,
  clearing_account_code     VARCHAR(50)  NOT NULL,
  over_short_account_code   VARCHAR(50)  DEFAULT NULL,
  invoice_status            VARCHAR(30)  NOT NULL DEFAULT 'pending',
  payment_status            VARCHAR(30)  NOT NULL DEFAULT 'pending',
  variance_status           VARCHAR(30)  NOT NULL DEFAULT 'pending',
  invoice_idempotency_key   VARCHAR(64)  NOT NULL,
  payment_idempotency_key   VARCHAR(64)  NOT NULL,
  variance_idempotency_key  VARCHAR(64)  NOT NULL,
  xero_invoice_id           VARCHAR(100) DEFAULT NULL,
  xero_payment_id           VARCHAR(100) DEFAULT NULL,
  xero_variance_id          VARCHAR(100) DEFAULT NULL,
  error_detail              TEXT         DEFAULT NULL,
  attempt_count             INT          NOT NULL DEFAULT 0,
  last_attempt_at           DATETIME     DEFAULT NULL,
  completed_at              DATETIME     DEFAULT NULL,
  created_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pos_cash_eod_action (business_id, eod_reconciliation_id),
  INDEX idx_pos_cash_eod_status (business_id, invoice_status, payment_status, variance_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Default destination bank account for physical cash lodgements by shop.
CREATE TABLE IF NOT EXISTS xero_cash_deposit_settings (
  business_id                   VARCHAR(255) NOT NULL,
  ims_location_id               INT          NOT NULL,
  destination_account_id        VARCHAR(100) NOT NULL,
  destination_account_code      VARCHAR(50)  NOT NULL,
  destination_account_name      VARCHAR(255) NOT NULL,
  created_at                    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, ims_location_id),
  INDEX idx_cash_deposit_settings_business (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS xero_cash_deposits (
  id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id                 VARCHAR(255) NOT NULL,
  ims_location_id             INT          NOT NULL,
  lodgement_date              DATE         NOT NULL,
  bank_reference              VARCHAR(255) DEFAULT NULL,
  notes                       TEXT         DEFAULT NULL,
  source_account_id           VARCHAR(100) NOT NULL,
  source_account_code         VARCHAR(50)  NOT NULL,
  source_account_name         VARCHAR(255) DEFAULT NULL,
  over_short_account_id       VARCHAR(100) DEFAULT NULL,
  over_short_account_code     VARCHAR(50)  DEFAULT NULL,
  over_short_account_name     VARCHAR(255) DEFAULT NULL,
  destination_account_id      VARCHAR(100) NOT NULL,
  destination_account_code    VARCHAR(50)  NOT NULL,
  destination_account_name    VARCHAR(255) NOT NULL,
  expected_total              DECIMAL(14,2) NOT NULL,
  counted_total               DECIMAL(14,2) NOT NULL,
  variance_total              DECIMAL(14,2) NOT NULL,
  status                      VARCHAR(30)  NOT NULL DEFAULT 'draft',
  prepared_by_user_id         BIGINT       NOT NULL,
  prepared_by_name            VARCHAR(255) NOT NULL,
  posted_by_user_id           BIGINT       DEFAULT NULL,
  posted_by_name              VARCHAR(255) DEFAULT NULL,
  posted_at                   DATETIME     DEFAULT NULL,
  xero_bank_transfer_id       VARCHAR(100) DEFAULT NULL,
  error_detail                TEXT         DEFAULT NULL,
  external_correction_note    TEXT         DEFAULT NULL,
  external_correction_ref     VARCHAR(255) DEFAULT NULL,
  external_correction_date    DATE         DEFAULT NULL,
  created_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cash_deposit_business (business_id, ims_location_id, lodgement_date),
  INDEX idx_cash_deposit_status (business_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS xero_cash_deposit_days (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  cash_deposit_id       BIGINT       NOT NULL,
  business_id           VARCHAR(255) NOT NULL,
  business_date         DATE         NOT NULL,
  expected_custody      DECIMAL(14,2) NOT NULL,
  counted_deposit       DECIMAL(14,2) NOT NULL,
  banking_variance      DECIMAL(14,2) NOT NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cash_deposit_day (cash_deposit_id, business_date),
  INDEX idx_cash_deposit_day_business (business_id, business_date),
  CONSTRAINT fk_cash_deposit_day_header FOREIGN KEY (cash_deposit_id) REFERENCES xero_cash_deposits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS xero_cash_deposit_sources (
  id                         BIGINT AUTO_INCREMENT PRIMARY KEY,
  cash_deposit_id            BIGINT       NOT NULL,
  cash_deposit_day_id        BIGINT       NOT NULL,
  business_id                VARCHAR(255) NOT NULL,
  eod_reconciliation_id      BIGINT       NOT NULL,
  expected_amount            DECIMAL(14,2) NOT NULL,
  counted_amount             DECIMAL(14,2) NOT NULL,
  opening_float              DECIMAL(14,2) NOT NULL,
  expected_custody           DECIMAL(14,2) NOT NULL,
  till_variance              DECIMAL(14,2) NOT NULL,
  accounting_version         INT          NOT NULL,
  xero_invoice_id            VARCHAR(100) DEFAULT NULL,
  xero_payment_id            VARCHAR(100) DEFAULT NULL,
  created_at                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cash_deposit_source (business_id, eod_reconciliation_id),
  INDEX idx_cash_deposit_source_header (cash_deposit_id),
  CONSTRAINT fk_cash_deposit_source_header FOREIGN KEY (cash_deposit_id) REFERENCES xero_cash_deposits(id) ON DELETE CASCADE,
  CONSTRAINT fk_cash_deposit_source_day FOREIGN KEY (cash_deposit_day_id) REFERENCES xero_cash_deposit_days(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS xero_cash_deposit_actions (
  id                       BIGINT AUTO_INCREMENT PRIMARY KEY,
  cash_deposit_id          BIGINT       NOT NULL,
  business_id              VARCHAR(255) NOT NULL,
  action_key               VARCHAR(255) NOT NULL,
  action_type              VARCHAR(40)  NOT NULL,
  business_date            DATE         DEFAULT NULL,
  amount                   DECIMAL(14,2) NOT NULL,
  status                   VARCHAR(30)  NOT NULL DEFAULT 'pending',
  idempotency_key          VARCHAR(64)  NOT NULL,
  xero_id                  VARCHAR(100) DEFAULT NULL,
  error_detail             TEXT         DEFAULT NULL,
  attempt_count            INT          NOT NULL DEFAULT 0,
  last_attempt_at          DATETIME     DEFAULT NULL,
  completed_at             DATETIME     DEFAULT NULL,
  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cash_deposit_action (business_id, action_key),
  INDEX idx_cash_deposit_action_header (cash_deposit_id, status),
  CONSTRAINT fk_cash_deposit_action_header FOREIGN KEY (cash_deposit_id) REFERENCES xero_cash_deposits(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One durable row per combined daily online invoice. payout_managed is an
-- explicit cutover guard: legacy invoices must never be settled automatically.
CREATE TABLE IF NOT EXISTS xero_online_batches (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id         VARCHAR(255) NOT NULL,
  batch_date          DATE         NOT NULL,
  xero_invoice_id     VARCHAR(100) DEFAULT NULL,
  xero_invoice_number VARCHAR(100) DEFAULT NULL,
  invoice_total       DECIMAL(14,2) NOT NULL DEFAULT 0,
  invoice_status      VARCHAR(30)  NOT NULL DEFAULT 'pending',
  gateway_allocations LONGTEXT     DEFAULT NULL,
  payout_managed      TINYINT(1)   NOT NULL DEFAULT 0,
  error_detail        TEXT         DEFAULT NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_xero_online_batch (business_id, batch_date),
  INDEX idx_xero_online_batch_status (business_id, payout_managed, invoice_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Durable per-order payments applied to a combined daily online invoice.
-- Used for gateways such as PayPal where each gross customer receipt appears
-- separately in the gateway's Xero bank account.
CREATE TABLE IF NOT EXISTS xero_online_order_payments (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id         VARCHAR(255) NOT NULL,
  payment_key         VARCHAR(255) NOT NULL,
  batch_date          DATE NOT NULL,
  xero_invoice_id     VARCHAR(100) NOT NULL,
  xero_payment_id     VARCHAR(100) DEFAULT NULL,
  account_code        VARCHAR(50) NOT NULL,
  amount              DECIMAL(14,2) NOT NULL,
  reference           VARCHAR(255) DEFAULT NULL,
  status              VARCHAR(30) NOT NULL DEFAULT 'pending',
  error_detail        TEXT DEFAULT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_xero_online_order_payment (business_id, payment_key),
  INDEX idx_xero_online_order_payment_batch (business_id, batch_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Durable calculated gateway fee spends posted after gross order payments.
CREATE TABLE IF NOT EXISTS xero_online_order_fees (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id         VARCHAR(255) NOT NULL,
  fee_key             VARCHAR(255) NOT NULL,
  payment_key         VARCHAR(255) NOT NULL,
  batch_date          DATE NOT NULL,
  gateway_name        VARCHAR(150) NOT NULL,
  xero_bank_transaction_id VARCHAR(100) DEFAULT NULL,
  bank_account_code   VARCHAR(50) NOT NULL,
  fee_account_code    VARCHAR(50) NOT NULL,
  fee_tax_type        VARCHAR(30) NOT NULL DEFAULT 'NONE',
  fee_amount          DECIMAL(14,2) NOT NULL,
  reference           VARCHAR(255) DEFAULT NULL,
  status              VARCHAR(30) NOT NULL DEFAULT 'pending',
  error_detail        TEXT DEFAULT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_xero_online_order_fee (business_id, fee_key),
  INDEX idx_xero_online_order_fee_batch (business_id, batch_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Shopify's paid payout is the settlement header. Reconciliation remains
-- blocked until every canonical balance transaction has been persisted.
CREATE TABLE IF NOT EXISTS shopify_payment_payouts (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id           VARCHAR(255) NOT NULL,
  shopify_payout_id     VARCHAR(100) NOT NULL,
  payout_date           DATE         DEFAULT NULL,
  shopify_status        VARCHAR(30)  NOT NULL,
  currency              VARCHAR(10)  NOT NULL,
  payout_amount         DECIMAL(14,2) NOT NULL,
  transaction_net_total DECIMAL(14,2) DEFAULT NULL,
  reconciliation_status VARCHAR(30)  NOT NULL DEFAULT 'pending',
  error_detail          TEXT         DEFAULT NULL,
  raw_payload           LONGTEXT     DEFAULT NULL,
  reconciled_at         DATETIME     DEFAULT NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shopify_payment_payout (business_id, shopify_payout_id),
  INDEX idx_shopify_payment_payout_status (business_id, reconciliation_status, payout_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Canonical Shopify Payments balance transactions. The transaction-level
-- unique key makes repeated webhook delivery and catch-up polling harmless.
CREATE TABLE IF NOT EXISTS shopify_payment_payout_transactions (
  id                          BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id                 VARCHAR(255) NOT NULL,
  shopify_transaction_id      VARCHAR(100) NOT NULL,
  shopify_payout_id           VARCHAR(100) NOT NULL,
  transaction_type            VARCHAR(50)  NOT NULL,
  amount                      DECIMAL(14,2) NOT NULL,
  fee                         DECIMAL(14,2) NOT NULL DEFAULT 0,
  net                         DECIMAL(14,2) NOT NULL,
  currency                    VARCHAR(10)   NOT NULL,
  source_id                   VARCHAR(100)  DEFAULT NULL,
  source_type                 VARCHAR(100)  DEFAULT NULL,
  source_order_id             VARCHAR(100)  DEFAULT NULL,
  source_order_transaction_id VARCHAR(100)  DEFAULT NULL,
  processed_at                DATETIME      DEFAULT NULL,
  business_date               DATE          DEFAULT NULL,
  raw_payload                 LONGTEXT      DEFAULT NULL,
  created_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shopify_payment_transaction (business_id, shopify_transaction_id),
  INDEX idx_shopify_payment_transaction_payout (business_id, shopify_payout_id),
  INDEX idx_shopify_payment_transaction_order (business_id, source_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every external Xero mutation has a stable action key and independent retry
-- state. This is the accounting idempotency ledger; xero_sync_log is audit only.
CREATE TABLE IF NOT EXISTS shopify_payment_xero_actions (
  id                     BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id            VARCHAR(255) NOT NULL,
  shopify_payout_id      VARCHAR(100) NOT NULL,
  action_key             VARCHAR(255) NOT NULL,
  action_type            VARCHAR(40)  NOT NULL,
  target_xero_document_id VARCHAR(100) DEFAULT NULL,
  action_date            DATE         NOT NULL,
  amount                 DECIMAL(14,2) NOT NULL,
  currency               VARCHAR(10)  NOT NULL,
  account_code           VARCHAR(50)  NOT NULL COMMENT 'Shopify clearing account',
  offset_account_code    VARCHAR(50)  DEFAULT NULL COMMENT 'Expense account for bank transactions',
  tax_type               VARCHAR(30)  DEFAULT NULL,
  reference              VARCHAR(255) NOT NULL,
  status                 VARCHAR(30)  NOT NULL DEFAULT 'pending',
  xero_id                VARCHAR(100) DEFAULT NULL,
  transaction_ids        LONGTEXT     DEFAULT NULL,
  error_detail           TEXT         DEFAULT NULL,
  attempt_count          INT          NOT NULL DEFAULT 0,
  last_attempt_at        DATETIME     DEFAULT NULL,
  completed_at           DATETIME     DEFAULT NULL,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shopify_payment_xero_action (business_id, action_key),
  INDEX idx_shopify_payment_xero_action_payout (business_id, shopify_payout_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
