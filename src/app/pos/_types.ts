// POS shared types — used across all POS components

export interface DeviceConfig {
  business_id:    string; // set during device setup via location code
  location_id:    number;
  location_name:  string;
  register_id:    number;
  register_name:  string;
}

export interface PosSession {
  pos_user_id:   number;
  username:      string;
  full_name:     string;
  location_id:   number;
  location_name: string;
  register_id:   number | null;
  register_name: string | null;
  tier?:         string; // UserTier — PosUser, PosManager, StandardUser, Admin, SuperAdmin
}

export interface CachedProduct {
  variant_id:     string;
  product_id:     string;
  code:           string | null;
  barcode:        string | null;
  name:           string;
  brand:          string | null;
  price:          number;
  original_price: number | null;
  cost:           number | null;
  soh:            number;
  soh_all:        number;
  available:      number;
  available_all:  number;
  image_url:      string | null;
}

export interface CartItem {
  localId:         string;
  variant_id:      string | null;
  code:            string | null;
  name:            string;
  qty:             number;
  unit_price:      number;
  original_price:  number | null;
  discount_type:   'none' | 'percent' | 'amount';
  discount_value:  number;
  discount_amount: number;
  tax_rate:        number;
  line_total:      number;
  is_gift_card?:   boolean;
  gift_card_code?: string;
}

export interface PaymentEntry {
  localId: string;
  method:  string;
  amount:  number;
  reference: string;
}

export interface ParkedSale {
  local_id:      string;
  server_id?:    number;
  label:         string;
  total:         number;
  items:         CartItem[];
  created_at:    string;
  customer_name?: string;
}

export interface CompletedSale {
  id:            number | null;
  local_id:      string;
  location_name: string;
  cashier_name:  string;
  sale_type:     'sale' | 'return' | 'layby';
  status:        string;
  items:         CartItem[];
  payments:      PaymentEntry[];
  subtotal:      number;
  discount_total: number;
  tax_total:     number;
  total:         number;
  cash_rounding?: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  notes?: string | null;
  created_at:    string;
}
