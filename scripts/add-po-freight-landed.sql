-- Migration: add freight column to ims_purchase_orders
-- and create ims_po_landed_costs table (if not already present).
-- Run once against the live IMS database.

ALTER TABLE ims_purchase_orders
  ADD COLUMN IF NOT EXISTS freight  DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Landed costs: separate-invoice import costs (customs, duties, etc.).
-- NOT included in the invoice total_amount, but ARE distributed
-- proportionally into variant avg_cost when the PO is received.
CREATE TABLE IF NOT EXISTS ims_po_landed_costs (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  po_id      INT NOT NULL,
  label      VARCHAR(200) NOT NULL,
  reference  VARCHAR(200),
  amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (po_id) REFERENCES ims_purchase_orders(id) ON DELETE CASCADE,
  INDEX idx_polc_po (po_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
