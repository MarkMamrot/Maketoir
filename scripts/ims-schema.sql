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
  name        VARCHAR(255) NOT NULL,
  company     VARCHAR(255),
  email       VARCHAR(255),
  phone       VARCHAR(50),
  address     TEXT,
  city        VARCHAR(100),
  state       VARCHAR(100),
  postcode    VARCHAR(20),
  country     VARCHAR(100) DEFAULT 'Australia',
  notes       TEXT,
  lead_time_days      INT DEFAULT NULL,
  order_frequency_days INT NOT NULL DEFAULT 45,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business_id (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Locations (Branches / Warehouses) ───────────────────────
CREATE TABLE IF NOT EXISTS ims_locations (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  business_id VARCHAR(100) NOT NULL DEFAULT '',
  name        VARCHAR(255) NOT NULL,
  code        VARCHAR(50),
  address     TEXT,
  city        VARCHAR(100),
  state       VARCHAR(100),
  postcode    VARCHAR(20),
  country     VARCHAR(100) DEFAULT 'Australia',
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business_id (business_id)
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
  price               DECIMAL(12,4),
  discounted_price    DECIMAL(12,4),
  discount_start_date DATE,
  discount_end_date   DATE,
  weight_kg           DECIMAL(8,4),
  shopify_variant_id  VARCHAR(100),
  is_active           TINYINT(1) NOT NULL DEFAULT 1,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES ims_products(product_id) ON DELETE CASCADE,
  INDEX idx_business_id (business_id),
  INDEX idx_pv_product (product_id),
  INDEX idx_pv_sku (sku)
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
  status        ENUM('draft','approved','received','cancelled') NOT NULL DEFAULT 'draft',
  order_date    DATE NOT NULL,
  expected_date DATE,
  received_date DATE,
  notes         TEXT,
  subtotal      DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  freight       DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business_id (business_id),
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
  tax_rate     DECIMAL(6,4) NOT NULL DEFAULT 0,
  line_total   DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes        VARCHAR(500),
  FOREIGN KEY (po_id) REFERENCES ims_purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES ims_product_variants(variant_id),
  INDEX idx_business_id (business_id),
  INDEX idx_poi_po (po_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Sales Orders ─────────────────────────────────────────────
-- draft     → confirmed  (adds qty_committed)
-- confirmed → fulfilled  (deducts qty_on_hand + qty_committed, snapshots unit_cost)
-- confirmed → draft      (reverses qty_committed)
-- any       → cancelled
CREATE TABLE IF NOT EXISTS ims_sales_orders (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  business_id      VARCHAR(100) NOT NULL DEFAULT '',
  so_number        VARCHAR(50) NOT NULL UNIQUE,
  customer_id      INT,
  price_tier       ENUM('retail','wholesale') NOT NULL DEFAULT 'retail',
  so_type          VARCHAR(10) NOT NULL DEFAULT 'b2b',
  location_id      INT NOT NULL,
  status           ENUM('draft','confirmed','fulfilled','cancelled') NOT NULL DEFAULT 'draft',
  order_date       DATE NOT NULL,
  expected_date    DATE,
  fulfilled_date   DATE,
  notes            TEXT,
  tax_treatment    ENUM('ex_tax','inc_tax','no_tax') NOT NULL DEFAULT 'ex_tax',
  subtotal         DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  shopify_order_id VARCHAR(100),
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business_id (business_id),
  FOREIGN KEY (customer_id) REFERENCES ims_contacts(id) ON DELETE SET NULL,
  FOREIGN KEY (location_id) REFERENCES ims_locations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Sales Order Items ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ims_sales_order_items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  business_id   VARCHAR(100) NOT NULL DEFAULT '',
  so_id         INT NOT NULL,
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
  INDEX idx_soi_so (so_id)
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
    'adjustment','transfer_in','transfer_out',
    'pos_sale','pos_return','stocktake'
  ) NOT NULL,
  reference_type ENUM('purchase_order','sales_order','manual','pos_sale','stocktake','branch_transfer') NOT NULL,
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
  xero_journal_id VARCHAR(100) NULL,
  xero_synced_at  DATETIME NULL,
  xero_sync_status ENUM('synced','queued','error') NULL,
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
  FOREIGN KEY (location_id) REFERENCES ims_locations(id),
  INDEX idx_pos_loc_date (location_id, created_at),
  INDEX idx_business_id (business_id),
  INDEX idx_ps_register (register_id),
  INDEX idx_ps_session (register_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── POS Sale Items ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_sale_items (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  business_id     VARCHAR(100) NOT NULL DEFAULT '',
  sale_id         INT NOT NULL,
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
  INDEX idx_psi_sale (sale_id)
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
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_eod (location_id, register_id, recon_date, payment_method),
  INDEX idx_eod_loc_date (location_id, recon_date),
  INDEX idx_business_id (business_id)
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
