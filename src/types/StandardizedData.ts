/**
 * Source-agnostic data interfaces for Marketoir.
 */

export interface StandardizedProduct {
  id: number | string;
  platformId?: number | string;
  name: string;
  category?: string;
  price: number;
  cost: number;
  grossMargin?: number;
  imageUrl?: string;
}

/**
 * source_type is an open string so any future system (Shopify, MYOB, etc.) can plug in
 * by implementing its own adapter that maps to these shapes.
 */

export interface StandardizedVariant {
  source_type:      string;        // 'cin7' | 'solvantis' | 'shopify' | ...
  source_id:        string;        // variant/option-level ID from the source system
  parent_source_id: string | null; // parent product ID (cin7_id / ims product_id)
  sku:              string | null;
  barcode:          string | null;
  name:             string;
  brand:            string | null;
  category:         string | null;
  style_code:       string | null;
  option_label:     string;        // e.g. "Red / M" or "Default"
  cost:             number | null;
  price:            number | null;
  qty_on_hand:      number;
  qty_incoming:     number;
  is_online:        boolean;
  pack_size:        number | null;
  created_date:     string | null;
}

/** Extends StandardizedVariant with pre-computed sales aggregates (from Cin7 products table or ims_sales_cache). */
export interface StandardizedVariantWithSales extends StandardizedVariant {
  sales_qty_7d:     number;
  sales_qty_90d:    number;
  sales_qty_180d:   number;
  sales_qty_12m:    number;
  global_available: number;
  supplier_id:      string | null;
}

export interface StandardizedContact {
  source_type:    string;
  source_id:      string;
  name:           string;
  company:        string | null;
  email:          string | null;
  phone:          string | null;
  type:           'supplier' | 'customer' | 'both';
  lead_time_days: number | null;
  order_frequency_days?: number | null;
}

export interface StandardizedLocation {
  source_type: string;
  source_id:   string;
  name:        string;
  code:        string | null;
  is_active:   boolean;
}

export interface VariantBranchStock {
  variant_id: string;  // corresponds to StandardizedVariant.source_id
  branch_id:  string;  // corresponds to StandardizedLocation.source_id
  soh:        number;
  available:  number;
  incoming:   number;
}

export interface StandardizedSaleLine {
  source_type:   string;
  source_id:     string;      // line item ID
  order_ref:     string;      // order_id or so_number
  date:          string;      // YYYY-MM-DD
  sku:           string | null;
  name:          string | null;
  qty:           number;
  unit_price:    number;
  line_total:    number;
  location_name: string | null;
  channel:       string | null; // 'POS-QV', 'Shopify ...', 'B2B ...', etc.
}

export interface StandardizedCreative {
  id: string;
  platformIds: Record<string, string>;
  type: 'video' | 'image' | 'text';
  url?: string;
  content?: string;
  tags: string[];
  status: 'learning' | 'scaling' | 'paused';
}

export interface MetricSummary {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpa: number;
  roas: number;
}
