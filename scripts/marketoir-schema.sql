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
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
  registered_at DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
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
  shopify_access_token     TEXT,
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
  ga4_property_id          VARCHAR(50),
  xero_tenant_id           VARCHAR(100),
  xero_tenant_name         VARCHAR(255),
  xero_access_token        TEXT,
  xero_refresh_token       TEXT,
  xero_token_expiry        BIGINT,
  updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
