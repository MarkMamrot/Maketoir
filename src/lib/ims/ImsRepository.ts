import { v4 as uuidv4 } from 'uuid';
import { getIMSPool, imsQuery, imsExecute } from '@/services/IMSMySQLService';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ContactType = 'supplier' | 'customer' | 'both';
export type POStatus    = 'draft' | 'confirmed' | 'partially_received' | 'received' | 'cancelled';
export type SOStatus    = 'draft' | 'confirmed' | 'fulfilled' | 'cancelled';

export interface ImsContact {
  id: number; type: ContactType; name: string; company?: string;
  email?: string; phone?: string; address?: string; city?: string;
  state?: string; postcode?: string; country?: string; notes?: string;
  lead_time_days?: number; order_frequency_days?: number; cin7_supplier_id?: number; cin7_contact_id?: number;
  is_active: number; price_tier?: string;
  charges_tax?: number; prices_include_tax?: number; tax_rate?: number;
  created_at?: string; updated_at?: string;
}

export interface ImsLocation {
  id: number; name: string; code?: string; address?: string;
  city?: string; state?: string; postcode?: string; country?: string;
  cin7_branch_id?: number; pos_pin?: string;
  is_active: number; created_at?: string; updated_at?: string;
}

export interface ImsProduct {
  id: number; product_id: string; name: string; description?: string;
  product_type?: string; brand?: string; tags?: string; category?: string;
  style_code?: string; is_online?: number; supplier_contact_id?: number; cin7_product_id?: number;
  is_active: number; shopify_product_id?: string; created_at?: string; updated_at?: string;
  variants?: ImsVariant[];
}

export interface ImsVariant {
  id: number; variant_id: string; product_id: string; sku?: string;
  barcode?: string; option1_name?: string; option1_value?: string;
  option2_name?: string; option2_value?: string; option3_name?: string;
  option3_value?: string; cost_aud?: number; price_rrp?: number; price_wholesale?: number;
  price_rrp_sale?: number; discount_start_date?: string;
  discount_end_date?: string; weight_kg?: number;
  pack_size?: number; cin7_option_id?: number;
  shopify_variant_id?: string;
  shopify_inventory_item_id?: string;
  is_active: number;
  cost_foreign?: string; // JSON: {"USD":10, "THB":350, ...} always ex-tax
  bin?: string;
  zone?: string;
  product_name?: string; // joined
  variant_label?: string; // joined
}

export interface ImsStock {
  id: number; variant_id: string; location_id: number;
  qty_on_hand: number; qty_incoming: number; qty_committed: number;
  min_qty: number; reorder_qty: number; avg_cost?: number; updated_at?: string;
  // joined
  sku?: string; product_name?: string; variant_label?: string; location_name?: string;
}

export interface ImsPayment {
  id: number;
  po_id?: number;
  so_id?: number;
  payment_date: string;
  amount: number;
  currency_code: string;
  exchange_rate: number;
  amount_local: number;
  notes?: string;
  payment_method_id?: number;
  payment_method_name?: string;
  created_at?: string;
}

export interface ImsPaymentMethod {
  id: number;
  business_id: string;
  name: string;
  type: 'po' | 'so';
  xero_account_code: string;
  sort_order?: number;
  is_active: boolean;
  created_at?: string;
}

export interface LandedCostRow {
  id?: number; po_id?: number;
  label: string; reference?: string | null; amount: number; sort_order?: number;
}

export interface ImsPO {
  id: number; po_number: string; supplier_id?: number; location_id: number;
  status: POStatus; order_date: string; expected_date?: string;
  received_date?: string; notes?: string; subtotal: number;
  tax_amount: number; freight?: number; discount?: number; total_amount: number; is_historical?: number;
  supplier_invoice_number?: string; payment_terms?: string;
  tax_treatment?: 'ex_tax' | 'inc_tax' | 'no_tax'; tax_code?: string;
  currency_code?: string; exchange_rate?: number;
  amount_paid?: number; amount_paid_local?: number; balance?: number; balance_local?: number;
  created_at?: string; updated_at?: string;
  supplier_name?: string; supplier_email?: string; location_name?: string;
  items?: ImsPOItem[]; payments?: ImsPayment[]; landed_costs?: LandedCostRow[]; files?: ImsPoFile[];
}

export interface ImsPOItem {
  id: number; po_id: number; variant_id: string | null; qty_ordered: number;
  qty_received: number; unit_cost: number; discount_pct: number; landed_cost_per_unit?: number; tax_rate: number;
  line_total: number; notes?: string;
  sku?: string; product_name?: string; variant_label?: string;
  name_raw?: string; sku_raw?: string;
}

export interface ImsSO {
  id: number; so_number: string; customer_id?: number; customer_po_number?: string; location_id: number;
  status: SOStatus; order_date: string; expected_date?: string;
  fulfilled_date?: string; notes?: string; subtotal: number;
  tax_amount: number; freight?: number; discount?: number; total_amount: number; is_historical?: number;
  shopify_order_id?: string; cin7_order_id?: string;
  payment_terms?: string; tax_code?: string;
  currency_code?: string; exchange_rate?: number;
  amount_paid?: number; amount_paid_local?: number; balance?: number; balance_local?: number;
  created_at?: string; updated_at?: string;
  customer_name?: string; customer_email?: string; location_name?: string;
  items?: ImsSOItem[]; payments?: ImsPayment[];
}

export interface ImsSOItem {
  id: number; so_id: number; variant_id: string | null;
  code?: string; name?: string;
  qty_ordered: number;
  qty_fulfilled: number; unit_price: number; unit_cost?: number;
  discount_pct: number; tax_rate: number; line_total: number; notes?: string;
  sku?: string; product_name?: string; variant_label?: string;
}

export type StocktakeStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled' | 'reverted';

export interface ImsStocktake {
  id: number; reference: string; location_id: number; status: StocktakeStatus;
  notes?: string; created_at?: string; completed_at?: string;
  location_name?: string;
  item_count?: number; variance_count?: number;
  xero_journal_id?: string | null; xero_synced_at?: string | null; xero_sync_status?: 'synced' | 'queued' | 'error' | null;
  items?: ImsStocktakeItem[];
}

export interface ImsStocktakeItem {
  id: number; stocktake_id: number; variant_id: string;
  expected_qty: number; counted_qty: number | null; notes?: string;
  sku?: string; product_name?: string; variant_label?: string; barcode?: string;
  avg_cost?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function variantLabel(v: { option1_value?: string; option2_value?: string; option3_value?: string }): string {
  return [v.option1_value, v.option2_value, v.option3_value].filter(Boolean).join(' / ') || 'Default';
}

async function ensureStock(variantId: string, locationId: number): Promise<void> {
  await imsExecute(
    `INSERT IGNORE INTO ims_stock (variant_id, location_id) VALUES (?, ?)`,
    [variantId, locationId]
  );
}

async function getStock(variantId: string, locationId: number): Promise<ImsStock | null> {
  const rows = await imsQuery<ImsStock>(
    `SELECT * FROM ims_stock WHERE variant_id = ? AND location_id = ?`,
    [variantId, locationId]
  );
  return rows[0] ?? null;
}

async function nextPONumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await imsQuery<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ims_purchase_orders WHERE po_number LIKE ?`,
    [`PO-${year}-%`]
  );
  const seq = String((rows[0]?.cnt ?? 0) + 1).padStart(4, '0');
  return `PO-${year}-${seq}`;
}

async function nextSONumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await imsQuery<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ims_sales_orders WHERE so_number LIKE ?`,
    [`SO-${year}-%`]
  );
  const seq = String((rows[0]?.cnt ?? 0) + 1).padStart(4, '0');
  return `SO-${year}-${seq}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contacts
// ─────────────────────────────────────────────────────────────────────────────

export const ImsContactsRepo = {
  async list(type?: ContactType, activeOnly?: boolean, businessId?: string): Promise<ImsContact[]> {
    const wheres: string[] = [];
    const params: any[] = [];
    if (businessId) { wheres.push('business_id = ?'); params.push(businessId); }
    if (type) { wheres.push(`(type = ? OR type = 'both')`); params.push(type); }
    if (activeOnly) { wheres.push('is_active = 1'); }
    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    return imsQuery<ImsContact>(
      `SELECT * FROM ims_contacts ${where} ORDER BY name`,
      params
    );
  },

  async get(id: number, businessId?: string): Promise<ImsContact | null> {
    const where = businessId ? 'WHERE id = ? AND business_id = ?' : 'WHERE id = ?';
    const params = businessId ? [id, businessId] : [id];
    const rows = await imsQuery<ImsContact>(`SELECT * FROM ims_contacts ${where}`, params);
    return rows[0] ?? null;
  },

  async create(data: Omit<ImsContact, 'id' | 'created_at' | 'updated_at'>, businessId?: string): Promise<number> {
    const res = await imsExecute(
      `INSERT INTO ims_contacts (business_id,type,name,company,email,phone,address,city,state,postcode,country,notes,is_active,cin7_supplier_id,lead_time_days,order_frequency_days,price_tier,charges_tax,prices_include_tax,tax_rate)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [businessId ?? '', data.type, data.name, data.company, data.email, data.phone,
       data.address, data.city, data.state, data.postcode, data.country,
       data.notes, data.is_active ?? 1, data.cin7_supplier_id ?? null, data.lead_time_days ?? null,
       data.order_frequency_days ?? 45,
       data.price_tier ?? 'retail',
       data.charges_tax ?? 1, data.prices_include_tax ?? 0, data.tax_rate ?? null]
    );
    return res.insertId;
  },

  async update(id: number, data: Partial<ImsContact>): Promise<void> {
    const fields = ['type','name','company','email','phone','address','city','state','postcode','country','notes','is_active','cin7_supplier_id','lead_time_days','order_frequency_days','price_tier','charges_tax','prices_include_tax','tax_rate'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const f of fields) {
      if (data[f as keyof ImsContact] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(data[f as keyof ImsContact]);
      }
    }
    if (!sets.length) return;
    vals.push(id);
    await imsExecute(`UPDATE ims_contacts SET ${sets.join(', ')} WHERE id = ?`, vals);
  },

  async delete(id: number): Promise<void> {
    await imsExecute(`DELETE FROM ims_contacts WHERE id = ?`, [id]);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Locations
// ─────────────────────────────────────────────────────────────────────────────

export const ImsLocationsRepo = {
  async list(businessId?: string): Promise<ImsLocation[]> {
    const where = businessId ? 'WHERE business_id = ?' : '';
    const params = businessId ? [businessId] : [];
    return imsQuery<ImsLocation>(`SELECT * FROM ims_locations ${where} ORDER BY name`, params);
  },

  async get(id: number, businessId?: string): Promise<ImsLocation | null> {
    const where = businessId ? 'WHERE id = ? AND business_id = ?' : 'WHERE id = ?';
    const params = businessId ? [id, businessId] : [id];
    const rows = await imsQuery<ImsLocation>(`SELECT * FROM ims_locations ${where}`, params);
    return rows[0] ?? null;
  },

  async create(data: Omit<ImsLocation, 'id' | 'created_at' | 'updated_at'>, businessId?: string): Promise<number> {
    const res = await imsExecute(
      `INSERT INTO ims_locations (business_id,name,code,address,city,state,postcode,country,is_active,cin7_branch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [businessId ?? '', data.name, data.code, data.address, data.city, data.state,
       data.postcode, data.country, data.is_active ?? 1, data.cin7_branch_id ?? null]
    );
    return res.insertId;
  },

  async update(id: number, data: Partial<ImsLocation>): Promise<void> {
    const fields = ['name','code','address','city','state','postcode','country','is_active','cin7_branch_id','pos_pin'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const f of fields) {
      if (data[f as keyof ImsLocation] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(data[f as keyof ImsLocation]);
      }
    }
    if (!sets.length) return;
    vals.push(id);
    await imsExecute(`UPDATE ims_locations SET ${sets.join(', ')} WHERE id = ?`, vals);
  },

  async delete(id: number): Promise<void> {
    await imsExecute(`DELETE FROM ims_locations WHERE id = ?`, [id]);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Products
// ─────────────────────────────────────────────────────────────────────────────

export const ImsProductsRepo = {
  async list(businessId?: string): Promise<ImsProduct[]> {
    const where = businessId ? 'WHERE p.business_id = ?' : '';
    const params = businessId ? [businessId] : [];
    const products = await imsQuery<ImsProduct>(
      `SELECT p.*, c.name AS supplier_name, c.is_active AS supplier_is_active
       FROM ims_products p
       LEFT JOIN ims_contacts c ON c.id = p.supplier_contact_id
       ${where}
       ORDER BY p.created_at DESC`,
      params
    );
    const variantWhere = businessId ? 'WHERE business_id = ?' : '';
    const variants = await imsQuery<ImsVariant>(
      `SELECT * FROM ims_product_variants ${variantWhere} ORDER BY sku`,
      params
    );
    const byProduct = new Map<string, ImsVariant[]>();
    for (const v of variants) {
      if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
      byProduct.get(v.product_id)!.push(v);
    }
    return products.map(p => ({ ...p, variants: byProduct.get(p.product_id) ?? [] }));
  },

  async get(productId: string, businessId?: string): Promise<ImsProduct | null> {
    const where = businessId ? 'WHERE product_id = ? AND business_id = ?' : 'WHERE product_id = ?';
    const params = businessId ? [productId, businessId] : [productId];
    const rows = await imsQuery<ImsProduct>(`SELECT * FROM ims_products ${where}`, params);
    if (!rows[0]) return null;
    const variants = await imsQuery<ImsVariant>(
      `SELECT * FROM ims_product_variants WHERE product_id = ? ORDER BY sku`, [productId]
    );
    return { ...rows[0], variants };
  },

  async create(
    data: Omit<ImsProduct, 'id' | 'created_at' | 'updated_at' | 'variants'>,
    businessId?: string
  ): Promise<string> {
    const product_id = data.product_id || uuidv4();
    await imsExecute(
      `INSERT INTO ims_products (business_id,product_id,name,description,product_type,brand,tags,is_active,shopify_product_id,style_code,is_online,supplier_contact_id,cin7_product_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [businessId ?? '', product_id, data.name, data.description ?? null, data.product_type ?? null, data.brand ?? null,
       data.tags ?? null, data.is_active ?? 1, data.shopify_product_id ?? null,
       data.style_code ?? null, data.is_online ?? 1, data.supplier_contact_id ?? null, data.cin7_product_id ?? null]
    );
    return product_id;
  },

  async update(productId: string, data: Partial<ImsProduct>): Promise<void> {
    const fields = ['name','description','product_type','brand','tags','is_active','shopify_product_id','style_code','is_online','supplier_contact_id','cin7_product_id'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const f of fields) {
      if (data[f as keyof ImsProduct] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(data[f as keyof ImsProduct]);
      }
    }
    if (!sets.length) return;
    vals.push(productId);
    await imsExecute(`UPDATE ims_products SET ${sets.join(', ')} WHERE product_id = ?`, vals);
  },

  async delete(productId: string): Promise<void> {
    await imsExecute(`DELETE FROM ims_products WHERE product_id = ?`, [productId]);
  },

  async findByName(name: string): Promise<ImsProduct | null> {
    const rows = await imsQuery<ImsProduct>(
      `SELECT * FROM ims_products WHERE LOWER(name) = LOWER(?) LIMIT 1`,
      [name]
    );
    return rows[0] ?? null;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Variants
// ─────────────────────────────────────────────────────────────────────────────

export const ImsVariantsRepo = {
  async listAll(businessId?: string): Promise<ImsVariant[]> {
    const where = businessId ? 'WHERE v.business_id = ?' : '';
    const params = businessId ? [businessId] : [];
    return imsQuery<ImsVariant>(
      `SELECT v.*, p.name AS product_name
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       ${where}
       ORDER BY p.name, v.sku`,
      params
    );
  },

  async listByProduct(productId: string): Promise<ImsVariant[]> {
    return imsQuery<ImsVariant>(
      `SELECT * FROM ims_product_variants WHERE product_id = ? ORDER BY sku`,
      [productId]
    );
  },

  async get(variantId: string): Promise<ImsVariant | null> {
    const rows = await imsQuery<ImsVariant>(
      `SELECT v.*, p.name AS product_name
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE v.variant_id = ?`,
      [variantId]
    );
    return rows[0] ?? null;
  },

  async create(data: Omit<ImsVariant, 'id' | 'created_at' | 'updated_at' | 'product_name'>): Promise<string> {
    const variant_id = data.variant_id || uuidv4();
    await imsExecute(
      `INSERT INTO ims_product_variants
         (variant_id,product_id,sku,barcode,option1_name,option1_value,
          option2_name,option2_value,option3_name,option3_value,
          cost_aud,price_rrp,price_wholesale,price_rrp_sale,discount_start_date,discount_end_date,
          weight_kg,shopify_variant_id,is_active,cost_foreign,pack_size,cin7_option_id,bin,zone)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [variant_id, data.product_id, data.sku ?? null, data.barcode ?? null,
       data.option1_name ?? null, data.option1_value ?? null, data.option2_name ?? null, data.option2_value ?? null,
       data.option3_name ?? null, data.option3_value ?? null, data.cost_aud ?? null, data.price_rrp ?? null,
       data.price_wholesale ?? null,
       data.price_rrp_sale ?? null, data.discount_start_date ?? null, data.discount_end_date ?? null,
       data.weight_kg ?? null, data.shopify_variant_id ?? null, data.is_active ?? 1,
       data.cost_foreign ?? null, data.pack_size ?? null, data.cin7_option_id ?? null,
       data.bin ?? null, data.zone ?? null]
    );
    return variant_id;
  },

  async update(variantId: string, data: Partial<ImsVariant>): Promise<void> {
    const fields = [
      'sku','barcode','option1_name','option1_value','option2_name','option2_value',
      'option3_name','option3_value','cost_aud','price_rrp','price_wholesale','price_rrp_sale',
      'discount_start_date','discount_end_date','weight_kg','shopify_variant_id','is_active',
      'cost_foreign','pack_size','cin7_option_id','bin','zone'
    ];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const f of fields) {
      if (data[f as keyof ImsVariant] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(data[f as keyof ImsVariant]);
      }
    }
    if (!sets.length) return;
    vals.push(variantId);
    await imsExecute(`UPDATE ims_product_variants SET ${sets.join(', ')} WHERE variant_id = ?`, vals);
  },

  async delete(variantId: string): Promise<void> {
    await imsExecute(`DELETE FROM ims_product_variants WHERE variant_id = ?`, [variantId]);
  },

  async findByBarcodeOrSku(query: string): Promise<ImsVariant | null> {
    const rows = await imsQuery<ImsVariant>(
      `SELECT v.*,
              p.name AS product_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''),
                NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')
              ) AS variant_label
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE v.barcode = ? OR v.sku = ?
       LIMIT 1`,
      [query, query]
    );
    return rows[0] ?? null;
  },

  async findBySku(sku: string): Promise<ImsVariant | null> {
    const rows = await imsQuery<ImsVariant>(
      `SELECT v.*, p.name AS product_name
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE v.sku = ? LIMIT 1`,
      [sku]
    );
    return rows[0] ?? null;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Brands
// ─────────────────────────────────────────────────────────────────────────────

export const ImsBrandsRepo = {
  async list(businessId?: string): Promise<{ id: number; name: string; created_at: string }[]> {
    const where = businessId ? 'WHERE business_id = ?' : '';
    const params = businessId ? [businessId] : [];
    return imsQuery(`SELECT id, name, created_at FROM ims_brands ${where} ORDER BY name`, params);
  },

  async create(name: string, businessId?: string): Promise<number> {
    const res = await imsExecute('INSERT INTO ims_brands (business_id, name) VALUES (?, ?)', [businessId ?? '', name.trim()]);
    return (res as any).insertId;
  },

  async update(id: number, name: string): Promise<void> {
    await imsExecute('UPDATE ims_brands SET name = ? WHERE id = ?', [name.trim(), id]);
  },

  async delete(id: number): Promise<void> {
    await imsExecute('DELETE FROM ims_brands WHERE id = ?', [id]);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Stock
// ─────────────────────────────────────────────────────────────────────────────

export const ImsStockRepo = {
  async list(variantId?: string, locationId?: number, businessId?: string): Promise<ImsStock[]> {
    const wheres: string[] = [];
    const params: any[] = [];
    if (businessId) { wheres.push('s.business_id = ?'); params.push(businessId); }
    if (variantId) { wheres.push('s.variant_id = ?'); params.push(variantId); }
    if (locationId) { wheres.push('s.location_id = ?'); params.push(locationId); }
    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    try {
      return await imsQuery<ImsStock>(
        `SELECT s.*,
                v.sku, p.name AS product_name,
                p.brand AS brand,
                p.zone AS zone,
                p.bin AS bin,
                p.created_at AS created_at,
                c.name AS supplier_name,
                c.is_active AS supplier_is_active,
                l.name AS location_name,
                CONCAT_WS(' / ',
                  NULLIF(v.option1_value,''),
                  NULLIF(v.option2_value,''),
                  NULLIF(v.option3_value,'')
                ) AS variant_label
         FROM ims_stock s
         JOIN ims_product_variants v ON v.variant_id = s.variant_id
         JOIN ims_products p ON p.product_id = v.product_id
         LEFT JOIN ims_contacts c ON c.id = p.supplier_contact_id
         JOIN ims_locations l ON l.id = s.location_id
         ${where}
         ORDER BY p.name, v.sku, l.name`,
        params
      );
    } catch {
      return imsQuery<ImsStock>(
        `SELECT s.*,
                v.sku, p.name AS product_name,
                p.brand AS brand,
                l.name AS location_name,
                CONCAT_WS(' / ',
                  NULLIF(v.option1_value,''),
                  NULLIF(v.option2_value,''),
                  NULLIF(v.option3_value,'')
                ) AS variant_label
         FROM ims_stock s
         JOIN ims_product_variants v ON v.variant_id = s.variant_id
         JOIN ims_products p ON p.product_id = v.product_id
         JOIN ims_locations l ON l.id = s.location_id
         ${where}
         ORDER BY p.name, v.sku, l.name`,
        params
      );
    }
  },

  async upsert(variantId: string, locationId: number, data: Partial<ImsStock>): Promise<void> {
    await imsExecute(
      `INSERT INTO ims_stock (variant_id, location_id, min_qty, reorder_qty)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         min_qty    = VALUES(min_qty),
         reorder_qty = VALUES(reorder_qty)`,
      [variantId, locationId, data.min_qty ?? 0, data.reorder_qty ?? 0]
    );
  },

  async getLowStock(businessId?: string): Promise<ImsStock[]> {
    const where = businessId ? 'AND s.business_id = ?' : '';
    const params = businessId ? [businessId] : [];
    return imsQuery<ImsStock>(
      `SELECT s.*,
              v.sku, p.name AS product_name,
              l.name AS location_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''),
                NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')
              ) AS variant_label
       FROM ims_stock s
       JOIN ims_product_variants v ON v.variant_id = s.variant_id
       JOIN ims_products p ON p.product_id = v.product_id
       JOIN ims_locations l ON l.id = s.location_id
       WHERE s.qty_on_hand <= s.min_qty AND s.min_qty > 0 ${where}
       ORDER BY (s.qty_on_hand - s.min_qty) ASC`,
      params
    );
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Purchase Orders
// ─────────────────────────────────────────────────────────────────────────────

export const ImsPORepo = {
  async list(status?: POStatus, businessId?: string): Promise<ImsPO[]> {
    const wheres: string[] = [];
    const params: any[] = [];
    if (businessId) { wheres.push('po.business_id = ?'); params.push(businessId); }
    if (status) { wheres.push('po.status = ?'); params.push(status); }
    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    try {
      return await imsQuery<ImsPO>(
        `SELECT po.*,
                COALESCE(c.name, po.supplier_name_raw) AS supplier_name,
                l.name AS location_name,
                COALESCE(pay.amount_paid, 0) AS amount_paid,
                COALESCE(pay.amount_paid_local, 0) AS amount_paid_local,
                po.total_amount - COALESCE(pay.amount_paid, 0) AS balance,
                (po.total_amount * po.exchange_rate) - COALESCE(pay.amount_paid_local, 0) AS balance_local
         FROM ims_purchase_orders po
         LEFT JOIN ims_contacts c ON c.id = po.supplier_id
         JOIN ims_locations l ON l.id = po.location_id
         LEFT JOIN (
           SELECT po_id,
                  SUM(amount) AS amount_paid,
                  SUM(amount_local) AS amount_paid_local
           FROM ims_purchase_order_payments
           GROUP BY po_id
         ) pay ON pay.po_id = po.id
         ${where}
         ORDER BY po.created_at DESC`,
        params
      );
    } catch {
      return imsQuery<ImsPO>(
        `SELECT po.*, COALESCE(c.name, po.supplier_name_raw) AS supplier_name, l.name AS location_name
         FROM ims_purchase_orders po
         LEFT JOIN ims_contacts c ON c.id = po.supplier_id
         JOIN ims_locations l ON l.id = po.location_id
         ${where}
         ORDER BY po.created_at DESC`,
        params
      );
    }
  },

  async get(id: number, businessId?: string): Promise<ImsPO | null> {
    const bizFilter = businessId ? ' AND po.business_id = ?' : '';
    const bizParam = businessId ? [businessId] : [];
    let rows: ImsPO[];
    let payments: ImsPayment[] = [];
    try {
      rows = await imsQuery<ImsPO>(
        `SELECT po.*,
                COALESCE(c.name, po.supplier_name_raw) AS supplier_name,
                c.email AS supplier_email,
                l.name  AS location_name,
                COALESCE(pay.amount_paid, 0) AS amount_paid,
                COALESCE(pay.amount_paid_local, 0) AS amount_paid_local,
                po.total_amount - COALESCE(pay.amount_paid, 0) AS balance,
                (po.total_amount * po.exchange_rate) - COALESCE(pay.amount_paid_local, 0) AS balance_local
         FROM ims_purchase_orders po
         LEFT JOIN ims_contacts c ON c.id = po.supplier_id
         JOIN ims_locations l ON l.id = po.location_id
         LEFT JOIN (
           SELECT po_id,
                  SUM(amount) AS amount_paid,
                  SUM(amount_local) AS amount_paid_local
           FROM ims_purchase_order_payments
           GROUP BY po_id
         ) pay ON pay.po_id = po.id
         WHERE po.id = ?${bizFilter}`,
        [id, ...bizParam]
      );
      payments = await imsQuery<ImsPayment>(
        `SELECT * FROM ims_purchase_order_payments WHERE po_id = ? ORDER BY payment_date ASC, id ASC`,
        [id]
      );
    } catch {
      rows = await imsQuery<ImsPO>(
        `SELECT po.*,
                c.name  AS supplier_name,
                c.email AS supplier_email,
                l.name  AS location_name
         FROM ims_purchase_orders po
         LEFT JOIN ims_contacts c ON c.id = po.supplier_id
         JOIN ims_locations l ON l.id = po.location_id
         WHERE po.id = ?${bizFilter}`,
        [id, ...bizParam]
      );
    }
    if (!rows[0]) return null;
    let items: ImsPOItem[];
    try {
      items = await imsQuery<ImsPOItem>(
        `SELECT i.*,
                COALESCE(v.sku, i.sku_raw)       AS sku,
                COALESCE(p.name, i.name_raw)      AS product_name,
                CONCAT_WS(' / ',
                  NULLIF(v.option1_value,''),
                  NULLIF(v.option2_value,''),
                  NULLIF(v.option3_value,'')
                ) AS variant_label
         FROM ims_purchase_order_items i
         LEFT JOIN ims_product_variants v ON v.variant_id = i.variant_id
         LEFT JOIN ims_products p ON p.product_id = v.product_id
         WHERE i.po_id = ?`,
        [id]
      );
    } catch {
      // sku_raw / name_raw columns not yet migrated — fall back
      items = await imsQuery<ImsPOItem>(
        `SELECT i.*,
                v.sku                            AS sku,
                p.name                           AS product_name,
                CONCAT_WS(' / ',
                  NULLIF(v.option1_value,''),
                  NULLIF(v.option2_value,''),
                  NULLIF(v.option3_value,'')
                ) AS variant_label
         FROM ims_purchase_order_items i
         LEFT JOIN ims_product_variants v ON v.variant_id = i.variant_id
         LEFT JOIN ims_products p ON p.product_id = v.product_id
         WHERE i.po_id = ?`,
        [id]
      );
    }
    let landed_costs: LandedCostRow[] = [];
    try {
      landed_costs = await imsQuery<LandedCostRow>(
        `SELECT id, po_id, label, reference, amount, sort_order FROM ims_po_landed_costs WHERE po_id = ? ORDER BY sort_order ASC, id ASC`,
        [id]
      );
    } catch { /* table not yet migrated */ }
    let files: ImsPoFile[] = [];
    try {
      files = await imsQuery<ImsPoFile>(
        `SELECT * FROM ims_po_files WHERE po_id = ? ORDER BY uploaded_at ASC`,
        [id]
      );
    } catch { /* table not yet migrated */ }
    return { ...rows[0], items, payments, landed_costs, files };
  },

  async addPayment(
    poId: number,
    data: { payment_date: string; amount: number; currency_code: string; exchange_rate: number; amount_local: number; notes?: string; payment_method_id?: number },
  ): Promise<ImsPayment> {
    const res = await imsExecute(
      `INSERT INTO ims_purchase_order_payments (po_id, payment_date, amount, currency_code, exchange_rate, amount_local, notes, payment_method_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [poId, data.payment_date, data.amount, data.currency_code, data.exchange_rate, data.amount_local, data.notes || null, data.payment_method_id ?? null],
    );
    const rows = await imsQuery<ImsPayment>(`SELECT p.*, pm.name AS payment_method_name FROM ims_purchase_order_payments p LEFT JOIN ims_payment_methods pm ON pm.id = p.payment_method_id WHERE p.id = ?`, [res.insertId]);
    return rows[0];
  },

  async deletePayment(paymentId: number): Promise<void> {
    await imsExecute(`DELETE FROM ims_purchase_order_payments WHERE id = ?`, [paymentId]);
  },

  async create(
    data: Omit<ImsPO, 'id' | 'created_at' | 'updated_at' | 'supplier_name' | 'location_name' | 'items'>,
    items: Omit<ImsPOItem, 'id' | 'po_id' | 'qty_received' | 'sku' | 'product_name' | 'variant_label'>[],
    landedCosts?: LandedCostRow[],
    businessId?: string,
  ): Promise<number> {
    const po_number = data.po_number || await nextPONumber();
    const taxTreatment = data.tax_treatment ?? 'ex_tax';
    const subtotal = taxTreatment === 'inc_tax'
      ? items.reduce((s, i) => {
          const tot = Number(i.line_total);
          const rate = Number(i.tax_rate ?? 0);
          return s + (rate > 0 ? tot / (1 + rate) : tot);
        }, 0)
      : items.reduce((s, i) => s + Number(i.line_total), 0);
    // Per-line rounding (matches Xero) + freight tax
    const freightTaxRate = taxTreatment === 'ex_tax'
      ? Number(items.find(i => Number(i.tax_rate) > 0)?.tax_rate ?? 0) : 0;
    const tax_amount = taxTreatment === 'no_tax'
      ? 0
      : taxTreatment === 'inc_tax'
        ? items.reduce((s, i) => {
            const tot = Number(i.line_total);
            const rate = Number(i.tax_rate ?? 0);
            const exTax = rate > 0 ? tot / (1 + rate) : tot;
            return s + Math.round((tot - exTax) * 100) / 100;
          }, 0)
        : items.reduce((s, i) => s + Math.round(Number(i.line_total) * Number(i.tax_rate) * 100) / 100, 0)
          + Math.round(Number(data.freight ?? 0) * freightTaxRate * 100) / 100;
    const freight = Number(data.freight ?? 0);
    const discount = Number(data.discount ?? 0);
    const total_amount = subtotal + tax_amount + freight - discount;

    const res = await imsExecute(
      `INSERT INTO ims_purchase_orders
         (business_id,po_number,supplier_id,location_id,status,order_date,expected_date,notes,
          supplier_invoice_number,payment_terms,tax_treatment,tax_code,currency_code,exchange_rate,
          freight,discount,subtotal,tax_amount,total_amount)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [businessId ?? '', po_number, data.supplier_id ?? null, data.location_id, 'draft',
       data.order_date, data.expected_date ?? null, data.notes ?? null,
       data.supplier_invoice_number ?? null, data.payment_terms ?? null,
       data.tax_treatment ?? 'ex_tax', data.tax_code ?? null,
       data.currency_code ?? 'AUD', data.exchange_rate ?? 1,
       freight, discount, subtotal, tax_amount, total_amount]
    );
    const po_id = res.insertId;
    for (const item of items) {
      const discPct = Number(item.discount_pct ?? 0);
      const line_total = Math.round(Number(item.qty_ordered) * Number(item.unit_cost) * (1 - discPct / 100) * 10000) / 10000;
      await imsExecute(
        `INSERT INTO ims_purchase_order_items
           (po_id,variant_id,qty_ordered,unit_cost,discount_pct,tax_rate,line_total,notes)
         VALUES (?,?,?,?,?,?,?,?)`,
        [po_id, item.variant_id, item.qty_ordered, item.unit_cost,
         discPct, item.tax_rate ?? 0, line_total, item.notes ?? null]
      );
    }
    if (landedCosts && landedCosts.length) {
      for (let i = 0; i < landedCosts.length; i++) {
        const c = landedCosts[i];
        await imsExecute(
          `INSERT INTO ims_po_landed_costs (po_id, label, reference, amount, sort_order) VALUES (?,?,?,?,?)`,
          [po_id, c.label, c.reference ?? null, Number(c.amount), i]
        );
      }
    }
    return po_id;
  },

  async update(
    id: number,
    data: Partial<Pick<ImsPO, 'supplier_id' | 'location_id' | 'order_date' | 'expected_date' | 'notes' | 'supplier_invoice_number' | 'payment_terms' | 'tax_treatment' | 'tax_code' | 'currency_code' | 'exchange_rate' | 'freight' | 'discount'>>,
    items?: Omit<ImsPOItem, 'id' | 'po_id' | 'qty_received' | 'sku' | 'product_name' | 'variant_label'>[],
    landedCosts?: LandedCostRow[],
  ): Promise<void> {
    const fields = ['supplier_id','location_id','order_date','expected_date','notes','supplier_invoice_number','payment_terms','tax_treatment','tax_code','currency_code','exchange_rate','freight','discount'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const f of fields) {
      if (data[f as keyof typeof data] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(data[f as keyof typeof data]);
      }
    }

    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (sets.length) {
        vals.push(id);
        await conn.execute(`UPDATE ims_purchase_orders SET ${sets.join(', ')} WHERE id = ?`, vals);
      }

      if (items) {
        await conn.execute(`DELETE FROM ims_purchase_order_items WHERE po_id = ?`, [id]);
        // Determine effective tax_treatment (new value if supplied, else from DB)
        let taxTreatment: string = data.tax_treatment ?? 'ex_tax';
        if (!data.tax_treatment) {
          const [[poMeta]] = await conn.execute<any[]>(`SELECT tax_treatment FROM ims_purchase_orders WHERE id=?`, [id]);
          taxTreatment = poMeta?.tax_treatment ?? 'ex_tax';
        }
        let subtotal = 0, tax_amount = 0;
        for (const item of items) {
          const discPct = Number(item.discount_pct ?? 0);
          const line_total = Math.round(Number(item.qty_ordered) * Number(item.unit_cost) * (1 - discPct / 100) * 10000) / 10000;
          const rate = Number(item.tax_rate ?? 0);
          let item_subtotal: number, item_tax: number;
          if (taxTreatment === 'inc_tax') {
            item_subtotal = rate > 0 ? line_total / (1 + rate) : line_total;
            item_tax      = line_total - item_subtotal;
          } else if (taxTreatment === 'no_tax') {
            item_subtotal = line_total;
            item_tax      = 0;
          } else {
            item_subtotal = line_total;
            item_tax      = Math.round(line_total * rate * 100) / 100; // per-line rounding matches Xero
          }
          subtotal   += item_subtotal;
          tax_amount += item_tax;
          await conn.execute(
            `INSERT INTO ims_purchase_order_items
               (po_id,variant_id,qty_ordered,unit_cost,discount_pct,tax_rate,line_total,notes)
             VALUES (?,?,?,?,?,?,?,?)`,
            [id, item.variant_id, item.qty_ordered, item.unit_cost,
             discPct, item.tax_rate ?? 0, line_total, item.notes ?? null]
          );
        }

        // Replace landed costs if provided
        if (landedCosts !== undefined) {
          try { await conn.execute(`DELETE FROM ims_po_landed_costs WHERE po_id = ?`, [id]); } catch {}
          for (let i = 0; i < landedCosts.length; i++) {
            const c = landedCosts[i];
            try {
              await conn.execute(
                `INSERT INTO ims_po_landed_costs (po_id, label, reference, amount, sort_order) VALUES (?,?,?,?,?)`,
                [id, c.label, c.reference ?? null, Number(c.amount), i]
              );
            } catch {}
          }
        }

        const [[existingPo]] = await conn.execute<any[]>(`SELECT freight, discount FROM ims_purchase_orders WHERE id=?`, [id]);
        const useDi = (typeof data.discount !== 'undefined') ? Number(data.discount) : Number(existingPo?.discount ?? 0);
        const useFreight = (typeof data.freight !== 'undefined') ? Number(data.freight) : Number(existingPo?.freight ?? 0);
        // Add freight tax (ex_tax mode only): use first non-zero item tax rate
        if (taxTreatment === 'ex_tax') {
          const freightTaxRate = Number(items.find((i: any) => Number(i.tax_rate) > 0)?.tax_rate ?? 0);
          tax_amount += Math.round(useFreight * freightTaxRate * 100) / 100;
        }
        await conn.execute(
          `UPDATE ims_purchase_orders SET subtotal=?, tax_amount=?, total_amount=? WHERE id=?`,
          [subtotal, tax_amount, subtotal + tax_amount + useFreight - useDi, id]
        );
      } else if (landedCosts !== undefined) {
        // Items not updated but landed costs were — just replace costs and recalc total
        try { await conn.execute(`DELETE FROM ims_po_landed_costs WHERE po_id = ?`, [id]); } catch {}
        for (let i = 0; i < landedCosts.length; i++) {
          const c = landedCosts[i];
          try {
            await conn.execute(
              `INSERT INTO ims_po_landed_costs (po_id, label, reference, amount, sort_order) VALUES (?,?,?,?,?)`,
              [id, c.label, c.reference ?? null, Number(c.amount), i]
            );
          } catch {}
        }
        const [[poRow]] = await conn.execute<any[]>(`SELECT subtotal, tax_amount, freight, discount FROM ims_purchase_orders WHERE id=?`, [id]);
        const useDi = (typeof data.discount !== 'undefined') ? Number(data.discount) : Number(poRow?.discount ?? 0);
        const useFreight = (typeof data.freight !== 'undefined') ? Number(data.freight) : Number(poRow?.freight ?? 0);
        await conn.execute(
          `UPDATE ims_purchase_orders SET total_amount=? WHERE id=?`,
          [Number(poRow?.subtotal ?? 0) + Number(poRow?.tax_amount ?? 0) + useFreight - useDi, id]
        );
      } else if (data.freight !== undefined || data.discount !== undefined) {
        // Freight or discount changed with no items — recalculate tax_amount and total
        const [[poRow]] = await conn.execute<any[]>(`SELECT subtotal, tax_amount, tax_treatment, freight, discount FROM ims_purchase_orders WHERE id=?`, [id]);
        const useDi = (typeof data.discount !== 'undefined') ? Number(data.discount) : Number(poRow?.discount ?? 0);
        const useFreight = (typeof data.freight !== 'undefined') ? Number(data.freight) : Number(poRow?.freight ?? 0);
        const poTaxTreatment = poRow?.tax_treatment ?? 'ex_tax';
        let newTaxAmount = Number(poRow?.tax_amount ?? 0);
        if (poTaxTreatment === 'ex_tax' && typeof data.freight !== 'undefined') {
          // Recalculate freight tax component using the first item's tax rate
          const [ftrRows] = await conn.execute<any[]>(`SELECT tax_rate FROM ims_purchase_order_items WHERE po_id = ? AND tax_rate > 0 LIMIT 1`, [id]);
          const freightTaxRate = Number((ftrRows as any[])[0]?.tax_rate ?? 0);
          const oldFreightTax = Math.round(Number(poRow?.freight ?? 0) * freightTaxRate * 100) / 100;
          const newFreightTax = Math.round(useFreight * freightTaxRate * 100) / 100;
          newTaxAmount = newTaxAmount - oldFreightTax + newFreightTax;
        }
        await conn.execute(
          `UPDATE ims_purchase_orders SET tax_amount=?, total_amount=? WHERE id=?`,
          [newTaxAmount, Number(poRow?.subtotal ?? 0) + newTaxAmount + useFreight - useDi, id]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async changeStatus(id: number, newStatus: POStatus, freightTreatment: 'expense' | 'capitalise' = 'expense'): Promise<void> {
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [[po]] = await conn.execute<any[]>(
        `SELECT * FROM ims_purchase_orders WHERE id = ?`, [id]
      );
      if (!po) throw new Error('Purchase order not found');
      if (po.is_historical) throw new Error('Cannot modify a historical Cin7 record');

      const items = await imsQuery<ImsPOItem>(
        `SELECT * FROM ims_purchase_order_items WHERE po_id = ?`, [id]
      );

      // Load landed costs for distribution on receive
      let landedCostRows: LandedCostRow[] = [];
      try {
        landedCostRows = await imsQuery<LandedCostRow>(
          `SELECT * FROM ims_po_landed_costs WHERE po_id = ? ORDER BY sort_order ASC, id ASC`, [id]
        );
      } catch {}

      const from = po.status as POStatus;
      const to   = newStatus;

      if (from === to) return; // no-op

      // ── draft → confirmed ─────────────────────────────────────
      if (from === 'draft' && to === 'confirmed') {
        for (const item of items) {
          await conn.execute(
            `INSERT INTO ims_stock (variant_id, location_id, qty_incoming)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE qty_incoming = qty_incoming + VALUES(qty_incoming)`,
            [item.variant_id, po.location_id, item.qty_ordered]
          );
          const [[s]] = await conn.execute<any[]>(
            `SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, po.location_id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
             VALUES (?,?,'po_approved','purchase_order',?,?,?,?)`,
            [item.variant_id, po.location_id, id, item.qty_ordered, s?.qty_on_hand ?? 0, item.unit_cost]
          );
        }
      }

      // ── confirmed → draft (undo confirm) ──────────────────────
      if (from === 'confirmed' && to === 'draft') {
        for (const item of items) {
          await conn.execute(
            `UPDATE ims_stock SET qty_incoming = GREATEST(0, qty_incoming - ?)
             WHERE variant_id=? AND location_id=?`,
            [item.qty_ordered, item.variant_id, po.location_id]
          );
          const [[s]] = await conn.execute<any[]>(
            `SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, po.location_id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh)
             VALUES (?,?,'po_unapproved','purchase_order',?,?,?)`,
            [item.variant_id, po.location_id, id, -item.qty_ordered, s?.qty_on_hand ?? 0]
          );
        }
      }

      // ── confirmed → received ───────────────────────────────────
      if (from === 'confirmed' && to === 'received') {
        // Distribute landed costs (and optionally freight) proportionally by item value
        const poSubtotal = items.reduce((s, i) => s + Number(i.qty_ordered) * Number(i.unit_cost), 0);
        const totalLanded = landedCostRows.reduce((s, c) => s + Number(c.amount), 0);
        // When capitalising freight, include it in the per-unit avg-cost calculation
        const effectiveTotalLanded = totalLanded + (freightTreatment === 'capitalise' ? Number(po.freight ?? 0) : 0);

        // Pre-compute landed_cost_per_unit for each item
        const landedPerUnit = new Map<number, number>();
        for (const item of items) {
          const itemValue = Number(item.qty_ordered) * Number(item.unit_cost);
          let lcpu = 0;
          if (effectiveTotalLanded > 0) {
            if (poSubtotal > 0) {
              lcpu = (effectiveTotalLanded * (itemValue / poSubtotal)) / Number(item.qty_ordered);
            } else {
              // Fallback: equal split by qty when all unit costs are zero
              const totalQty = items.reduce((s, i) => s + Number(i.qty_ordered), 0);
              lcpu = totalQty > 0 ? effectiveTotalLanded / totalQty : 0;
            }
          }
          landedPerUnit.set(item.id, lcpu);
          if (totalLanded > 0) {
            await conn.execute(
              `UPDATE ims_purchase_order_items SET landed_cost_per_unit = ? WHERE id = ?`,
              [lcpu, item.id]
            );
          }
        }

        for (const item of items) {
          await conn.execute(
            `INSERT IGNORE INTO ims_stock (variant_id, location_id) VALUES (?, ?)`,
            [item.variant_id, po.location_id]
          );
          const [[s]] = await conn.execute<any[]>(
            `SELECT qty_on_hand, avg_cost FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, po.location_id]
          );

          // Determine effective exchange rate: payment-derived weighted avg, else stored rate
          let effective_rate = Number(po.exchange_rate ?? 1);
          try {
            const [[pymtAgg]] = await conn.execute<any[]>(
              `SELECT SUM(amount) AS tot_foreign, SUM(amount_local) AS tot_local
               FROM ims_purchase_order_payments WHERE po_id = ?`, [id]
            );
            const totForeign = Number(pymtAgg?.tot_foreign ?? 0);
            const totLocal   = Number(pymtAgg?.tot_local ?? 0);
            if (totForeign > 0) effective_rate = totLocal / totForeign;
          } catch {}

          const old_soh   = Number(s?.qty_on_hand ?? 0);
          const old_avg   = Number(s?.avg_cost ?? item.unit_cost);
          const qty_rcvd  = Number(item.qty_ordered);
          const lcpu      = landedPerUnit.get(item.id) ?? 0;
          // unit_cost is in PO currency → convert to AUD first, then add landed cost (already AUD)
          const true_cost_aud = Number(item.unit_cost) * effective_rate + lcpu;
          const new_avg   = old_soh <= 0
            ? true_cost_aud
            : (old_avg * old_soh + true_cost_aud * qty_rcvd) / (old_soh + qty_rcvd);
          const new_soh   = old_soh + qty_rcvd;

          await conn.execute(
            `UPDATE ims_stock
             SET qty_on_hand  = ?,
                 qty_incoming = GREATEST(0, qty_incoming - ?),
                 avg_cost     = ?
             WHERE variant_id=? AND location_id=?`,
            [new_soh, qty_rcvd, new_avg, item.variant_id, po.location_id]
          );
          await conn.execute(
            `UPDATE ims_purchase_order_items SET qty_received = qty_ordered WHERE id = ?`,
            [item.id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
             VALUES (?,?,'po_received','purchase_order',?,?,?,?)`,
            [item.variant_id, po.location_id, id, qty_rcvd, new_soh, true_cost_aud]
          );
        }
        await conn.execute(
          `UPDATE ims_purchase_orders SET received_date = CURDATE() WHERE id = ?`, [id]
        );
      }

      // ── partially_received → received (force-close a partially received PO from IMS) ───────────
      if (from === 'partially_received' && to === 'received') {
        const poSubtotal = items.reduce((s, i) => s + Number(i.qty_ordered) * Number(i.unit_cost), 0);
        const totalLanded = landedCostRows.reduce((s, c) => s + Number(c.amount), 0);
        const effectiveTotalLanded = totalLanded + (freightTreatment === 'capitalise' ? Number(po.freight ?? 0) : 0);

        const landedPerUnit = new Map<number, number>();
        for (const item of items) {
          const itemValue = Number(item.qty_ordered) * Number(item.unit_cost);
          let lcpu = 0;
          if (effectiveTotalLanded > 0) {
            if (poSubtotal > 0) {
              lcpu = (effectiveTotalLanded * (itemValue / poSubtotal)) / Number(item.qty_ordered);
            } else {
              const totalQty = items.reduce((s, i) => s + Number(i.qty_ordered), 0);
              lcpu = totalQty > 0 ? effectiveTotalLanded / totalQty : 0;
            }
          }
          landedPerUnit.set(item.id, lcpu);
          if (totalLanded > 0) {
            await conn.execute(
              `UPDATE ims_purchase_order_items SET landed_cost_per_unit = ? WHERE id = ?`,
              [lcpu, item.id]
            );
          }
        }

        for (const item of items) {
          const remaining = Number(item.qty_ordered) - Number(item.qty_received ?? 0);
          if (remaining <= 0) continue; // already fully received via device

          await conn.execute(
            `INSERT IGNORE INTO ims_stock (variant_id, location_id) VALUES (?, ?)`,
            [item.variant_id, po.location_id]
          );
          const [[s]] = await conn.execute<any[]>(
            `SELECT qty_on_hand, avg_cost FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, po.location_id]
          );

          let effective_rate = Number(po.exchange_rate ?? 1);
          try {
            const [[pymtAgg]] = await conn.execute<any[]>(
              `SELECT SUM(amount) AS tot_foreign, SUM(amount_local) AS tot_local
               FROM ims_purchase_order_payments WHERE po_id = ?`, [id]
            );
            const totForeign = Number(pymtAgg?.tot_foreign ?? 0);
            const totLocal   = Number(pymtAgg?.tot_local ?? 0);
            if (totForeign > 0) effective_rate = totLocal / totForeign;
          } catch {}

          const old_soh       = Number(s?.qty_on_hand ?? 0);
          const old_avg       = Number(s?.avg_cost ?? item.unit_cost);
          const lcpu          = landedPerUnit.get(item.id) ?? 0;
          const true_cost_aud = Number(item.unit_cost) * effective_rate + lcpu;
          const new_avg       = old_soh <= 0
            ? true_cost_aud
            : (old_avg * old_soh + true_cost_aud * remaining) / (old_soh + remaining);
          const new_soh       = old_soh + remaining;

          await conn.execute(
            `UPDATE ims_stock
             SET qty_on_hand  = ?,
                 qty_incoming = GREATEST(0, qty_incoming - ?),
                 avg_cost     = ?
             WHERE variant_id=? AND location_id=?`,
            [new_soh, remaining, new_avg, item.variant_id, po.location_id]
          );
          await conn.execute(
            `UPDATE ims_purchase_order_items SET qty_received = qty_ordered WHERE id = ?`,
            [item.id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
             VALUES (?,?,'po_received','purchase_order',?,?,?,?)`,
            [item.variant_id, po.location_id, id, remaining, new_soh, true_cost_aud]
          );
        }
        await conn.execute(
          `UPDATE ims_purchase_orders SET received_date = CURDATE() WHERE id = ?`, [id]
        );
      }

      // ── partially_received → confirmed (revert a partial receive) ───────────────
      if (from === 'partially_received' && to === 'confirmed') {
        for (const item of items) {
          const alreadyReceived = Number(item.qty_received ?? 0);
          if (alreadyReceived <= 0) continue;
          await conn.execute(
            `UPDATE ims_stock
             SET qty_on_hand  = GREATEST(0, qty_on_hand - ?),
                 qty_incoming = qty_incoming + ?
             WHERE variant_id=? AND location_id=?`,
            [alreadyReceived, alreadyReceived, item.variant_id, po.location_id]
          );
          const [[s]] = await conn.execute<any[]>(
            `SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, po.location_id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh)
             VALUES (?,?,'po_unapproved','purchase_order',?,?,?)`,
            [item.variant_id, po.location_id, id, -alreadyReceived, s?.qty_on_hand ?? 0]
          );
          await conn.execute(
            `UPDATE ims_purchase_order_items SET qty_received = 0 WHERE id = ?`,
            [item.id]
          );
        }
      }

      // ── received → confirmed (revert a fully received PO) ─────────────────────
      if (from === 'received' && to === 'confirmed') {
        for (const item of items) {
          const alreadyReceived = Number(item.qty_received ?? 0);
          if (alreadyReceived <= 0) continue;
          await conn.execute(
            `UPDATE ims_stock
             SET qty_on_hand  = GREATEST(0, qty_on_hand - ?),
                 qty_incoming = qty_incoming + ?
             WHERE variant_id=? AND location_id=?`,
            [alreadyReceived, alreadyReceived, item.variant_id, po.location_id]
          );
          const [[s]] = await conn.execute<any[]>(
            `SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, po.location_id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh)
             VALUES (?,?,'po_unapproved','purchase_order',?,?,?)`,
            [item.variant_id, po.location_id, id, -alreadyReceived, s?.qty_on_hand ?? 0]
          );
          await conn.execute(
            `UPDATE ims_purchase_order_items SET qty_received = 0 WHERE id = ?`,
            [item.id]
          );
        }
        await conn.execute(
          `UPDATE ims_purchase_orders SET received_date = NULL WHERE id = ?`, [id]
        );
      }

      // ── any → cancelled ──────────────────────────────────────
      if (to === 'cancelled' && from === 'confirmed') {
        for (const item of items) {
          await conn.execute(
            `UPDATE ims_stock SET qty_incoming = GREATEST(0, qty_incoming - ?)
             WHERE variant_id=? AND location_id=?`,
            [item.qty_ordered, item.variant_id, po.location_id]
          );
          const [[s]] = await conn.execute<any[]>(
            `SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, po.location_id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh)
             VALUES (?,?,'po_unapproved','purchase_order',?,?,?)`,
            [item.variant_id, po.location_id, id, -item.qty_ordered, s?.qty_on_hand ?? 0]
          );
        }
      }

      // ── partially_received → cancelled ───────────────────────────────────────
      if (to === 'cancelled' && from === 'partially_received') {
        for (const item of items) {
          const alreadyReceived = Number(item.qty_received ?? 0);
          const remainingIncoming = Math.max(0, Number(item.qty_ordered) - alreadyReceived);
          if (alreadyReceived > 0) {
            await conn.execute(
              `UPDATE ims_stock SET qty_on_hand = GREATEST(0, qty_on_hand - ?)
               WHERE variant_id=? AND location_id=?`,
              [alreadyReceived, item.variant_id, po.location_id]
            );
          }
          if (remainingIncoming > 0) {
            await conn.execute(
              `UPDATE ims_stock SET qty_incoming = GREATEST(0, qty_incoming - ?)
               WHERE variant_id=? AND location_id=?`,
              [remainingIncoming, item.variant_id, po.location_id]
            );
          }
          const [[s]] = await conn.execute<any[]>(
            `SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, po.location_id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh)
             VALUES (?,?,'po_unapproved','purchase_order',?,?,?)`,
            [item.variant_id, po.location_id, id, -(alreadyReceived + remainingIncoming), s?.qty_on_hand ?? 0]
          );
          await conn.execute(
            `UPDATE ims_purchase_order_items SET qty_received = 0 WHERE id = ?`,
            [item.id]
          );
        }
      }

      await conn.execute(
        `UPDATE ims_purchase_orders SET status = ? WHERE id = ?`, [to, id]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async delete(id: number): Promise<void> {
    await imsExecute(`DELETE FROM ims_purchase_orders WHERE id = ?`, [id]);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sales Orders
// ─────────────────────────────────────────────────────────────────────────────

export const ImsSORepo = {
  async list(status?: SOStatus, businessId?: string): Promise<ImsSO[]> {
    const wheres: string[] = ["so.so_type = 'b2b'"];
    const params: any[] = [];
    if (businessId) { wheres.push('so.business_id = ?'); params.push(businessId); }
    if (status) { wheres.push('so.status = ?'); params.push(status); }
    const where = 'WHERE ' + wheres.join(' AND ');
    try {
      return await imsQuery<ImsSO>(
        `SELECT so.*,
                c.name AS customer_name,
                l.name AS location_name,
                COALESCE(pay.amount_paid, 0) AS amount_paid,
                COALESCE(pay.amount_paid_local, 0) AS amount_paid_local,
                so.total_amount - COALESCE(pay.amount_paid, 0) AS balance,
                (so.total_amount * so.exchange_rate) - COALESCE(pay.amount_paid_local, 0) AS balance_local
         FROM ims_sales_orders so
         LEFT JOIN ims_contacts c ON c.id = so.customer_id
         JOIN ims_locations l ON l.id = so.location_id
         LEFT JOIN (
           SELECT so_id,
                  SUM(amount) AS amount_paid,
                  SUM(amount_local) AS amount_paid_local
           FROM ims_sales_order_payments
           GROUP BY so_id
         ) pay ON pay.so_id = so.id
         ${where}
         ORDER BY so.created_at DESC`,
        params
      );
    } catch {
      return imsQuery<ImsSO>(
        `SELECT so.*, c.name AS customer_name, l.name AS location_name
         FROM ims_sales_orders so
         LEFT JOIN ims_contacts c ON c.id = so.customer_id
         JOIN ims_locations l ON l.id = so.location_id
         ${where}
         ORDER BY so.created_at DESC`,
        params
      );
    }
  },

  async get(id: number, businessId?: string): Promise<ImsSO | null> {
    const bizFilter = businessId ? ' AND so.business_id = ?' : '';
    const bizParam = businessId ? [businessId] : [];
    let rows: ImsSO[];
    let payments: ImsPayment[] = [];
    try {
      rows = await imsQuery<ImsSO>(
        `SELECT so.*,
                c.name  AS customer_name,
                c.email AS customer_email,
                l.name  AS location_name,
                COALESCE(pay.amount_paid, 0) AS amount_paid,
                COALESCE(pay.amount_paid_local, 0) AS amount_paid_local,
                so.total_amount - COALESCE(pay.amount_paid, 0) AS balance,
                (so.total_amount * so.exchange_rate) - COALESCE(pay.amount_paid_local, 0) AS balance_local
         FROM ims_sales_orders so
         LEFT JOIN ims_contacts c ON c.id = so.customer_id
         JOIN ims_locations l ON l.id = so.location_id
         LEFT JOIN (
           SELECT so_id,
                  SUM(amount) AS amount_paid,
                  SUM(amount_local) AS amount_paid_local
           FROM ims_sales_order_payments
           GROUP BY so_id
         ) pay ON pay.so_id = so.id
         WHERE so.id = ?${bizFilter}`,
        [id, ...bizParam]
      );
      payments = await imsQuery<ImsPayment>(
        `SELECT * FROM ims_sales_order_payments WHERE so_id = ? ORDER BY payment_date ASC, id ASC`,
        [id]
      );
    } catch {
      rows = await imsQuery<ImsSO>(
        `SELECT so.*,
                c.name  AS customer_name,
                c.email AS customer_email,
                l.name  AS location_name
         FROM ims_sales_orders so
         LEFT JOIN ims_contacts c ON c.id = so.customer_id
         JOIN ims_locations l ON l.id = so.location_id
         WHERE so.id = ?${bizFilter}`,
        [id, ...bizParam]
      );
    }
    if (!rows[0]) return null;
    const items = await imsQuery<ImsSOItem>(
      `SELECT i.*,
              COALESCE(v.sku, i.code) AS sku,
              COALESCE(p.name, i.name, i.notes) AS product_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''),
                NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')
              ) AS variant_label,
              sk.avg_cost AS unit_cost
       FROM ims_sales_order_items i
       LEFT JOIN ims_product_variants v ON v.variant_id = i.variant_id
       LEFT JOIN ims_products p ON p.product_id = v.product_id
       LEFT JOIN ims_stock sk
         ON sk.variant_id = i.variant_id
         AND sk.location_id = (SELECT location_id FROM ims_sales_orders WHERE id = i.so_id)
       WHERE i.so_id = ?`,
      [id]
    );
    return { ...rows[0], items, payments };
  },

  async addPayment(
    soId: number,
    data: { payment_date: string; amount: number; currency_code: string; exchange_rate: number; amount_local: number; notes?: string; payment_method_id?: number },
  ): Promise<ImsPayment> {
    const res = await imsExecute(
      `INSERT INTO ims_sales_order_payments (so_id, payment_date, amount, currency_code, exchange_rate, amount_local, notes, payment_method_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [soId, data.payment_date, data.amount, data.currency_code, data.exchange_rate, data.amount_local, data.notes || null, data.payment_method_id ?? null],
    );
    const rows = await imsQuery<ImsPayment>(`SELECT p.*, pm.name AS payment_method_name FROM ims_sales_order_payments p LEFT JOIN ims_payment_methods pm ON pm.id = p.payment_method_id WHERE p.id = ?`, [res.insertId]);
    return rows[0];
  },

  async deletePayment(paymentId: number): Promise<void> {
    await imsExecute(`DELETE FROM ims_sales_order_payments WHERE id = ?`, [paymentId]);
  },

  async create(
    data: Omit<ImsSO, 'id' | 'created_at' | 'updated_at' | 'customer_name' | 'location_name' | 'items'>,
    items: Omit<ImsSOItem, 'id' | 'so_id' | 'qty_fulfilled' | 'unit_cost' | 'sku' | 'product_name' | 'variant_label'>[],
    businessId?: string,
  ): Promise<number> {
    const so_number = data.so_number || await nextSONumber();
    let subtotal = 0, tax_amount = 0;
    for (const item of items) {
      const disc  = 1 - Number(item.discount_pct ?? 0);
      const line  = Number(item.qty_ordered) * Number(item.unit_price) * disc;
      subtotal   += line;
      tax_amount += line * Number(item.tax_rate ?? 0);
    }
    const soFreight  = Number(data.freight ?? 0);
    const soDiscount = Number(data.discount ?? 0);

    const res = await imsExecute(
      `INSERT INTO ims_sales_orders
         (business_id,so_number,customer_id,customer_po_number,location_id,status,order_date,expected_date,notes,
          payment_terms,tax_code,freight,discount,subtotal,tax_amount,total_amount,shopify_order_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [businessId ?? '', so_number, data.customer_id ?? null, data.customer_po_number ?? null, data.location_id, 'draft',
       data.order_date, data.expected_date ?? null, data.notes ?? null,
       data.payment_terms ?? null, data.tax_code ?? null, soFreight, soDiscount,
       subtotal, tax_amount, subtotal + tax_amount + soFreight - soDiscount, data.shopify_order_id ?? null]
    );
    const so_id = res.insertId;
    for (const item of items) {
      const disc      = 1 - Number(item.discount_pct ?? 0);
      const line_total = Number(item.qty_ordered) * Number(item.unit_price) * disc;
      await imsExecute(
        `INSERT INTO ims_sales_order_items
           (so_id,variant_id,qty_ordered,unit_price,discount_pct,tax_rate,line_total,notes)
         VALUES (?,?,?,?,?,?,?,?)`,
        [so_id, item.variant_id, item.qty_ordered, item.unit_price,
         item.discount_pct ?? 0, item.tax_rate ?? 0, line_total, item.notes ?? null]
      );
    }
    return so_id;
  },

  async update(
    id: number,
    data: Partial<Pick<ImsSO, 'customer_id' | 'customer_po_number' | 'location_id' | 'order_date' | 'expected_date' | 'notes' | 'payment_terms' | 'tax_code' | 'freight' | 'discount'>>,
    items?: Omit<ImsSOItem, 'id' | 'so_id' | 'qty_fulfilled' | 'unit_cost' | 'sku' | 'product_name' | 'variant_label'>[],
  ): Promise<void> {
    const fields = ['customer_id','customer_po_number','location_id','order_date','expected_date','notes','payment_terms','tax_code','freight','discount'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const f of fields) {
      if (data[f as keyof typeof data] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(data[f as keyof typeof data]);
      }
    }

    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (sets.length) {
        vals.push(id);
        await conn.execute(`UPDATE ims_sales_orders SET ${sets.join(', ')} WHERE id = ?`, vals);
      }

      if (items) {
        await conn.execute(`DELETE FROM ims_sales_order_items WHERE so_id = ?`, [id]);
        let subtotal = 0, tax_amount = 0;
        for (const item of items) {
          const disc      = 1 - Number(item.discount_pct ?? 0);
          const line_total = Number(item.qty_ordered) * Number(item.unit_price) * disc;
          subtotal   += line_total;
          tax_amount += line_total * Number(item.tax_rate ?? 0);
          await conn.execute(
            `INSERT INTO ims_sales_order_items
               (so_id,variant_id,qty_ordered,unit_price,discount_pct,tax_rate,line_total,notes)
             VALUES (?,?,?,?,?,?,?,?)`,
            [id, item.variant_id, item.qty_ordered, item.unit_price,
             item.discount_pct ?? 0, item.tax_rate ?? 0, line_total, item.notes ?? null]
          );
        }
        const [[existingSo]] = await conn.execute<any[]>(`SELECT freight, discount FROM ims_sales_orders WHERE id=?`, [id]);
        const useSoFr = (typeof data.freight !== 'undefined') ? Number(data.freight) : Number(existingSo?.freight ?? 0);
        const useSoDi = (typeof data.discount !== 'undefined') ? Number(data.discount) : Number(existingSo?.discount ?? 0);
        await conn.execute(
          `UPDATE ims_sales_orders SET subtotal=?, tax_amount=?, total_amount=? WHERE id=?`,
          [subtotal, tax_amount, subtotal + tax_amount + useSoFr - useSoDi, id]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async changeStatus(id: number, newStatus: SOStatus): Promise<void> {
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [[so]] = await conn.execute<any[]>(
        `SELECT * FROM ims_sales_orders WHERE id = ?`, [id]
      );
      if (!so) throw new Error('Sales order not found');
      if (so.is_historical) throw new Error('Cannot modify a historical Cin7 record');

      const items = await imsQuery<ImsSOItem>(
        `SELECT * FROM ims_sales_order_items WHERE so_id = ?`, [id]
      );

      const from = so.status as SOStatus;
      const to   = newStatus;

      if (from === to) return;

      // ── draft → confirmed ────────────────────────────────────
      if (from === 'draft' && to === 'confirmed') {
        for (const item of items) {
          await conn.execute(
            `INSERT INTO ims_stock (variant_id, location_id, qty_committed)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE qty_committed = qty_committed + VALUES(qty_committed)`,
            [item.variant_id, so.location_id, item.qty_ordered]
          );
          const [[s]] = await conn.execute<any[]>(
            `SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, so.location_id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh)
             VALUES (?,?,'so_confirmed','sales_order',?,?,?)`,
            [item.variant_id, so.location_id, id, 0, s?.qty_on_hand ?? 0]
          );
        }
      }

      // ── confirmed → draft ────────────────────────────────────
      if (from === 'confirmed' && to === 'draft') {
        for (const item of items) {
          await conn.execute(
            `UPDATE ims_stock SET qty_committed = GREATEST(0, qty_committed - ?)
             WHERE variant_id=? AND location_id=?`,
            [item.qty_ordered, item.variant_id, so.location_id]
          );
          const [[s]] = await conn.execute<any[]>(
            `SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, so.location_id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh)
             VALUES (?,?,'so_unconfirmed','sales_order',?,?,?)`,
            [item.variant_id, so.location_id, id, 0, s?.qty_on_hand ?? 0]
          );
        }
      }

      // ── confirmed → fulfilled ────────────────────────────────
      if (from === 'confirmed' && to === 'fulfilled') {
        for (const item of items) {
          await conn.execute(
            `INSERT IGNORE INTO ims_stock (variant_id, location_id) VALUES (?, ?)`,
            [item.variant_id, so.location_id]
          );
          const [[s]] = await conn.execute<any[]>(
            `SELECT qty_on_hand, avg_cost FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, so.location_id]
          );
          const old_soh  = Number(s?.qty_on_hand ?? 0);
          const avg_cost = Number(s?.avg_cost ?? 0);
          const qty      = Number(item.qty_ordered);
          const new_soh  = old_soh - qty;

          await conn.execute(
            `UPDATE ims_stock
             SET qty_on_hand  = ?,
                 qty_committed = GREATEST(0, qty_committed - ?)
             WHERE variant_id=? AND location_id=?`,
            [new_soh, qty, item.variant_id, so.location_id]
          );
          await conn.execute(
            `UPDATE ims_sales_order_items SET qty_fulfilled = qty_ordered, unit_cost = ? WHERE id = ?`,
            [avg_cost, item.id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
             VALUES (?,?,'so_fulfilled','sales_order',?,?,?,?)`,
            [item.variant_id, so.location_id, id, -qty, new_soh, avg_cost]
          );
        }
        await conn.execute(
          `UPDATE ims_sales_orders SET fulfilled_date = CURDATE() WHERE id = ?`, [id]
        );
      }

      // ── any → cancelled (reverse committed if was confirmed) ─
      if (to === 'cancelled' && from === 'confirmed') {
        for (const item of items) {
          await conn.execute(
            `UPDATE ims_stock SET qty_committed = GREATEST(0, qty_committed - ?)
             WHERE variant_id=? AND location_id=?`,
            [item.qty_ordered, item.variant_id, so.location_id]
          );
        }
      }

      await conn.execute(
        `UPDATE ims_sales_orders SET status = ? WHERE id = ?`, [to, id]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async delete(id: number): Promise<void> {
    await imsExecute(`DELETE FROM ims_sales_orders WHERE id = ?`, [id]);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard stats
// ─────────────────────────────────────────────────────────────────────────────

export const ImsDashboardRepo = {
  async getStats(businessId?: string) {
    const biz = businessId ? 'WHERE business_id = ?' : '';
    const p = businessId ? [businessId] : [];
    const [products] = await imsQuery<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ims_products WHERE is_active = 1 ${businessId ? 'AND business_id = ?' : ''}`, p
    );
    const [variants] = await imsQuery<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ims_product_variants WHERE is_active = 1 ${businessId ? 'AND business_id = ?' : ''}`, p
    );
    const [locations] = await imsQuery<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ims_locations WHERE is_active = 1 ${businessId ? 'AND business_id = ?' : ''}`, p
    );
    const [openPOs] = await imsQuery<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ims_purchase_orders WHERE status IN ('draft','ordered') ${businessId ? 'AND business_id = ?' : ''}`, p
    );
    const [openSOs] = await imsQuery<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ims_sales_orders WHERE status IN ('draft','confirmed') ${businessId ? 'AND business_id = ?' : ''}`, p
    );
    const [lowStock] = await imsQuery<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ims_stock WHERE qty_on_hand <= min_qty AND min_qty > 0 ${businessId ? 'AND business_id = ?' : ''}`, p
    );
    const recentPOs = await imsQuery<ImsPO>(
      `SELECT po.*, COALESCE(c.name, po.supplier_name_raw) AS supplier_name, l.name AS location_name
       FROM ims_purchase_orders po
       LEFT JOIN ims_contacts c ON c.id = po.supplier_id
       JOIN ims_locations l ON l.id = po.location_id
       ${businessId ? 'WHERE po.business_id = ?' : ''}
       ORDER BY po.created_at DESC LIMIT 5`, p
    );
    const recentSOs = await imsQuery<ImsSO>(
      `SELECT so.*, c.name AS customer_name, l.name AS location_name
       FROM ims_sales_orders so
       LEFT JOIN ims_contacts c ON c.id = so.customer_id
       JOIN ims_locations l ON l.id = so.location_id
       ${businessId ? 'WHERE so.business_id = ?' : ''}
       ORDER BY so.created_at DESC LIMIT 5`, p
    );
    return {
      products:  products?.cnt  ?? 0,
      variants:  variants?.cnt  ?? 0,
      locations: locations?.cnt ?? 0,
      openPOs:   openPOs?.cnt   ?? 0,
      openSOs:   openSOs?.cnt   ?? 0,
      lowStock:  lowStock?.cnt  ?? 0,
      recentPOs,
      recentSOs,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Stocktakes
// ─────────────────────────────────────────────────────────────────────────────

export const ImsStocktakeRepo = {
  async list(): Promise<ImsStocktake[]> {
    return imsQuery<ImsStocktake>(
      `SELECT st.*,
              l.name AS location_name,
              COUNT(i.id) AS item_count,
              SUM(i.counted_qty IS NOT NULL AND i.counted_qty <> i.expected_qty) AS variance_count
       FROM ims_stocktakes st
       JOIN ims_locations l ON l.id = st.location_id
       LEFT JOIN ims_stocktake_items i ON i.stocktake_id = st.id
       GROUP BY st.id
       ORDER BY st.created_at DESC`,
      []
    );
  },

  async get(id: number): Promise<ImsStocktake | null> {
    const rows = await imsQuery<ImsStocktake>(
      `SELECT st.*, l.name AS location_name
       FROM ims_stocktakes st
       JOIN ims_locations l ON l.id = st.location_id
       WHERE st.id = ?`,
      [id]
    );
    if (!rows[0]) return null;
    const st = rows[0];
    st.items = await imsQuery<ImsStocktakeItem>(
      `SELECT i.*,
              v.sku, v.barcode,
              p.name AS product_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''),
                NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')
              ) AS variant_label,
              sk.avg_cost
       FROM ims_stocktake_items i
       JOIN ims_product_variants v ON v.variant_id = i.variant_id
       JOIN ims_products p ON p.product_id = v.product_id
       LEFT JOIN ims_stock sk ON sk.variant_id = i.variant_id AND sk.location_id = ?
       WHERE i.stocktake_id = ?
       ORDER BY p.name, v.sku`,
      [st.location_id, id]
    );
    return st;
  },

  async create(data: {
    reference: string;
    location_id: number;
    notes?: string;
    blank?: boolean;
    brand_id?: number;
    supplier_id?: number;
    product_type?: string;
  }): Promise<number> {
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [res] = await conn.execute<any>(
        `INSERT INTO ims_stocktakes (reference, location_id, status, notes)
         VALUES (?, ?, 'draft', ?)`,
        [data.reference, data.location_id, data.notes ?? null]
      );
      const stocktakeId: number = res.insertId;

      if (!data.blank) {
        // Build variant filter and pre-populate
        const varWheres: string[] = ['v.is_active = 1'];
        const varParams: any[] = [];
        if (data.brand_id) {
          varWheres.push('p.brand = (SELECT name FROM ims_brands WHERE id = ?)');
          varParams.push(data.brand_id);
        }
        if (data.supplier_id) {
          varWheres.push('p.supplier_id = ?');
          varParams.push(data.supplier_id);
        }
        if (data.product_type) {
          varWheres.push('p.product_type = ?');
          varParams.push(data.product_type);
        }
        const variants = await imsQuery<{ variant_id: string; qty_on_hand: number }>(
          `SELECT v.variant_id,
                  COALESCE(s.qty_on_hand, 0) AS qty_on_hand
           FROM ims_product_variants v
           JOIN ims_products p ON p.product_id = v.product_id
           LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
           WHERE ${varWheres.join(' AND ')}`,
          [data.location_id, ...varParams]
        );
        if (variants.length > 0) {
          const placeholders = variants.map(() => '(?,?,?)').join(',');
          const vals: any[] = [];
          for (const v of variants) vals.push(stocktakeId, v.variant_id, v.qty_on_hand);
          await conn.execute(
            `INSERT INTO ims_stocktake_items (stocktake_id, variant_id, expected_qty) VALUES ${placeholders}`,
            vals
          );
        }
      }

      await conn.commit();
      return stocktakeId;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async removeItem(itemId: number): Promise<void> {
    await imsExecute('DELETE FROM ims_stocktake_items WHERE id = ?', [itemId]);
  },

  async addItem(stocktakeId: number, variantId: string, locationId: number): Promise<any> {
    // Check not already present
    const existing = await imsQuery<{ id: number }>(
      'SELECT id FROM ims_stocktake_items WHERE stocktake_id = ? AND variant_id = ?',
      [stocktakeId, variantId]
    );
    if (existing.length) throw new Error('Variant already in this stocktake.');
    // Get current stock as expected_qty
    const stock = await imsQuery<{ qty_on_hand: number }>(
      'SELECT COALESCE(qty_on_hand, 0) AS qty_on_hand FROM ims_stock WHERE variant_id = ? AND location_id = ?',
      [variantId, locationId]
    );
    const expectedQty = stock[0]?.qty_on_hand ?? 0;
    await imsExecute(
      'INSERT INTO ims_stocktake_items (stocktake_id, variant_id, expected_qty) VALUES (?, ?, ?)',
      [stocktakeId, variantId, expectedQty]
    );
    const rows = await imsQuery<any>(
      `SELECT i.*, v.sku, v.barcode,
              p.name AS product_name,
              CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label
       FROM ims_stocktake_items i
       JOIN ims_product_variants v ON v.variant_id = i.variant_id
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE i.stocktake_id = ? AND i.variant_id = ?`,
      [stocktakeId, variantId]
    );
    return rows[0];
  },

  async searchVariants(query: string, stocktakeId: number, locationId: number): Promise<any[]> {
    const like = `%${query}%`;
    return imsQuery<any>(
      `SELECT v.variant_id, v.sku, v.barcode,
              p.name AS product_name,
              CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant_label,
              COALESCE(s.qty_on_hand, 0) AS qty_on_hand
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
       WHERE v.is_active = 1
         AND v.variant_id NOT IN (SELECT variant_id FROM ims_stocktake_items WHERE stocktake_id = ?)
         AND (v.sku LIKE ? OR v.barcode LIKE ? OR p.name LIKE ?)
       ORDER BY p.name, v.sku
       LIMIT 20`,
      [locationId, stocktakeId, like, like, like]
    );
  },

  async updateItem(itemId: number, counted_qty: number | null, notes?: string): Promise<void> {
    await imsExecute(
      `UPDATE ims_stocktake_items SET counted_qty = ?, notes = ? WHERE id = ?`,
      [counted_qty, notes ?? null, itemId]
    );
  },

  async changeStatus(id: number, to: StocktakeStatus): Promise<void> {
    const allowed: Record<StocktakeStatus, StocktakeStatus[]> = {
      draft:       ['in_progress', 'cancelled'],
      in_progress: ['completed', 'cancelled'],
      completed:   [],
      cancelled:   [],
      reverted:    [],
    };
    const rows = await imsQuery<{ status: StocktakeStatus }>(`SELECT status FROM ims_stocktakes WHERE id = ?`, [id]);
    const st = rows[0];
    if (!st) throw new Error('Stocktake not found');
    if (!allowed[st.status].includes(to)) throw new Error(`Cannot transition from ${st.status} to ${to}`);
    await imsExecute(`UPDATE ims_stocktakes SET status = ? WHERE id = ?`, [to, id]);
  },

  async applyToStock(id: number): Promise<{ applied: number; variances: number }> {
    const full = await ImsStocktakeRepo.get(id);
    if (!full) throw new Error('Stocktake not found');
    if (full.status !== 'completed') throw new Error('Stocktake must be completed before applying');
    const items = (full.items ?? []).filter(i => i.counted_qty !== null);

    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let variances = 0;
      for (const item of items) {
        const counted = Number(item.counted_qty);
        const expected = Number(item.expected_qty);
        // Ensure stock row exists
        await conn.execute(
          `INSERT IGNORE INTO ims_stock (variant_id, location_id) VALUES (?, ?)`,
          [item.variant_id, full.location_id]
        );
        await conn.execute(
          `UPDATE ims_stock SET qty_on_hand = ? WHERE variant_id = ? AND location_id = ?`,
          [counted, item.variant_id, full.location_id]
        );
        if (counted !== expected) {
          variances++;
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id, location_id, movement_type, reference_type, reference_id, qty_change, qty_after_soh)
             VALUES (?, ?, 'stocktake', 'stocktake', ?, ?, ?)`,
            [item.variant_id, full.location_id, id, counted - expected, counted]
          );
        }
      }
      await conn.execute(
        `UPDATE ims_stocktakes SET completed_at = NOW() WHERE id = ?`, [id]
      );
      await conn.commit();
      return { applied: items.length, variances };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async delete(id: number): Promise<void> {
    const rows = await imsQuery<{ status: string }>(`SELECT status FROM ims_stocktakes WHERE id = ?`, [id]);
    const deletable = ['draft', 'cancelled', 'in_progress', 'reverted'];
    if (!deletable.includes(rows[0]?.status)) throw new Error('Only incomplete or reverted stocktakes can be deleted');
    await imsExecute(`DELETE FROM ims_stocktake_items WHERE stocktake_id = ?`, [id]);
    await imsExecute(`DELETE FROM ims_stocktakes WHERE id = ?`, [id]);
  },

  async revertFromStock(id: number): Promise<{ reverted: number }> {
    const full = await ImsStocktakeRepo.get(id);
    if (!full) throw new Error('Stocktake not found');
    if (full.status !== 'completed') throw new Error('Only completed stocktakes can be reverted');
    const items = (full.items ?? []).filter(i => i.counted_qty !== null);

    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const item of items) {
        const expected = Number(item.expected_qty);
        await conn.execute(
          `UPDATE ims_stock SET qty_on_hand = ? WHERE variant_id = ? AND location_id = ?`,
          [expected, item.variant_id, full.location_id]
        );
      }
      // Remove variance movements recorded for this stocktake
      await conn.execute(
        `DELETE FROM ims_stock_movements WHERE reference_type = 'stocktake' AND reference_id = ?`,
        [id]
      );
      await conn.execute(
        `UPDATE ims_stocktakes SET status = 'reverted', completed_at = NULL WHERE id = ?`,
        [id]
      );
      await conn.commit();
      return { reverted: items.length };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async previewVariants(data: {
    location_id: number;
    brand_id?: number;
    supplier_id?: number;
    product_type?: string;
  }): Promise<number> {
    const varWheres: string[] = ['v.is_active = 1'];
    const varParams: any[] = [];
    if (data.brand_id) {
      varWheres.push('p.brand = (SELECT name FROM ims_brands WHERE id = ?)');
      varParams.push(data.brand_id);
    }
    if (data.supplier_id) {
      varWheres.push('p.supplier_id = ?');
      varParams.push(data.supplier_id);
    }
    if (data.product_type) {
      varWheres.push('p.product_type = ?');
      varParams.push(data.product_type);
    }
    const rows = await imsQuery<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE ${varWheres.join(' AND ')}`,
      varParams
    );
    return rows[0]?.cnt ?? 0;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Branch Transfers
// ─────────────────────────────────────────────────────────────────────────────

export type BTStatus = 'draft' | 'sent' | 'received' | 'cancelled';

export interface ImsBT {
  id: number; transfer_number: string;
  from_location_id: number; to_location_id: number;
  status: BTStatus; transfer_date: string;
  notes?: string; received_date?: string; total_value: number;
  created_at?: string; updated_at?: string;
  from_location_name?: string; to_location_name?: string;
  items?: ImsBTItem[];
}

export interface ImsBTItem {
  id: number; transfer_id: number; variant_id: string;
  qty_sent: number; qty_received: number | null;
  unit_cost: number; line_value: number; notes?: string;
  sku?: string; barcode?: string; product_name?: string; variant_label?: string; price_rrp?: string;
}

async function nextBTNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await imsQuery<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ims_branch_transfers WHERE transfer_number LIKE ?`,
    [`BT-${year}-%`]
  );
  const seq = String((rows[0]?.cnt ?? 0) + 1).padStart(4, '0');
  return `BT-${year}-${seq}`;
}

export const ImsBTRepo = {
  async list(status?: BTStatus): Promise<ImsBT[]> {
    const where = status ? 'WHERE bt.status = ?' : '';
    const params: any[] = status ? [status] : [];
    return imsQuery<ImsBT>(
      `SELECT bt.*,
              fl.name AS from_location_name,
              tl.name AS to_location_name
         FROM ims_branch_transfers bt
         JOIN ims_locations fl ON fl.id = bt.from_location_id
         JOIN ims_locations tl ON tl.id = bt.to_location_id
         ${where}
         ORDER BY bt.transfer_date DESC, bt.id DESC`,
      params
    );
  },

  async get(id: number): Promise<ImsBT | null> {
    const rows = await imsQuery<ImsBT>(
      `SELECT bt.*,
              fl.name AS from_location_name,
              tl.name AS to_location_name
         FROM ims_branch_transfers bt
         JOIN ims_locations fl ON fl.id = bt.from_location_id
         JOIN ims_locations tl ON tl.id = bt.to_location_id
         WHERE bt.id = ?`,
      [id]
    );
    if (!rows.length) return null;
    const items = await imsQuery<ImsBTItem>(
      `SELECT bti.*,
              v.sku, v.barcode, v.price_rrp,
              p.name AS product_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''), NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')) AS variant_label
         FROM ims_branch_transfer_items bti
         JOIN ims_product_variants v ON v.variant_id = bti.variant_id
         JOIN ims_products p ON p.product_id = v.product_id
         WHERE bti.transfer_id = ?`,
      [id]
    );
    return { ...rows[0], items };
  },

  async create(
    data: Omit<ImsBT, 'id' | 'created_at' | 'updated_at' | 'from_location_name' | 'to_location_name' | 'items'>,
    items: { variant_id: string; qty_sent: number; unit_cost: number; notes?: string }[],
  ): Promise<number> {
    const transfer_number = data.transfer_number || await nextBTNumber();
    let total_value = 0;
    for (const item of items) total_value += Number(item.qty_sent) * Number(item.unit_cost);

    const res = await imsExecute(
      `INSERT INTO ims_branch_transfers
         (transfer_number, from_location_id, to_location_id, status, transfer_date, notes, total_value)
       VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
      [transfer_number, data.from_location_id, data.to_location_id,
       data.transfer_date, data.notes ?? null, total_value]
    );
    const transfer_id = res.insertId;
    for (const item of items) {
      const line_value = Number(item.qty_sent) * Number(item.unit_cost);
      await imsExecute(
        `INSERT INTO ims_branch_transfer_items
           (transfer_id, variant_id, qty_sent, unit_cost, line_value, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [transfer_id, item.variant_id, item.qty_sent, item.unit_cost, line_value, item.notes ?? null]
      );
    }
    return transfer_id;
  },

  async update(
    id: number,
    data: Partial<Pick<ImsBT, 'from_location_id' | 'to_location_id' | 'transfer_date' | 'notes'>>,
    items?: { variant_id: string; qty_sent: number; unit_cost: number; notes?: string }[],
  ): Promise<void> {
    const fields = ['from_location_id', 'to_location_id', 'transfer_date', 'notes'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const f of fields) {
      if (data[f as keyof typeof data] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(data[f as keyof typeof data]);
      }
    }
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (sets.length) {
        vals.push(id);
        await conn.execute(`UPDATE ims_branch_transfers SET ${sets.join(', ')} WHERE id = ?`, vals);
      }
      if (items) {
        await conn.execute(`DELETE FROM ims_branch_transfer_items WHERE transfer_id = ?`, [id]);
        let total_value = 0;
        for (const item of items) {
          const line_value = Number(item.qty_sent) * Number(item.unit_cost);
          total_value += line_value;
          await conn.execute(
            `INSERT INTO ims_branch_transfer_items
               (transfer_id, variant_id, qty_sent, unit_cost, line_value, notes)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, item.variant_id, item.qty_sent, item.unit_cost, line_value, item.notes ?? null]
          );
        }
        await conn.execute(`UPDATE ims_branch_transfers SET total_value = ? WHERE id = ?`, [total_value, id]);
      }
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
  },

  async changeStatus(
    id: number,
    newStatus: BTStatus,
    receivedItems?: { item_id: number; qty_received: number }[],
  ): Promise<void> {
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[bt]] = await conn.execute<any[]>(`SELECT * FROM ims_branch_transfers WHERE id = ?`, [id]);
      if (!bt) throw new Error('Branch transfer not found');

      const items = await imsQuery<ImsBTItem>(
        `SELECT * FROM ims_branch_transfer_items WHERE transfer_id = ?`, [id]
      );

      const from = bt.status as BTStatus;
      const to   = newStatus;
      if (from === to) { await conn.commit(); return; }

      // Allowed transitions
      const allowed: Record<string, string[]> = {
        draft: ['sent', 'cancelled'],
        sent:  ['received', 'cancelled'],
      };
      if (!allowed[from]?.includes(to)) throw new Error(`Cannot transition from ${from} to ${to}`);

      // sent → received: apply stock movements
      if (from === 'sent' && to === 'received') {
        for (const item of items) {
          const found = receivedItems?.find(r => r.item_id === item.id);
          const qty_rcvd = found != null ? Number(found.qty_received) : Number(item.qty_sent);

          await conn.execute(
            `UPDATE ims_branch_transfer_items SET qty_received = ? WHERE id = ?`,
            [qty_rcvd, item.id]
          );
          if (qty_rcvd <= 0) continue;

          // Deduct from source
          await conn.execute(
            `INSERT IGNORE INTO ims_stock (variant_id, location_id, qty_on_hand) VALUES (?, ?, 0)`,
            [item.variant_id, bt.from_location_id]
          );
          const [[src]] = await conn.execute<any[]>(
            `SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, bt.from_location_id]
          );
          const src_new_soh = Number(src?.qty_on_hand ?? 0) - qty_rcvd;
          await conn.execute(
            `UPDATE ims_stock SET qty_on_hand = ? WHERE variant_id=? AND location_id=?`,
            [src_new_soh, item.variant_id, bt.from_location_id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
             VALUES (?,?,'transfer_out','branch_transfer',?,?,?,?)`,
            [item.variant_id, bt.from_location_id, id, -qty_rcvd, src_new_soh, item.unit_cost]
          );

          // Add to destination
          await conn.execute(
            `INSERT IGNORE INTO ims_stock (variant_id, location_id, qty_on_hand) VALUES (?, ?, 0)`,
            [item.variant_id, bt.to_location_id]
          );
          const [[dst]] = await conn.execute<any[]>(
            `SELECT qty_on_hand, avg_cost FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, bt.to_location_id]
          );
          const old_dst_soh = Number(dst?.qty_on_hand ?? 0);
          const old_dst_avg = Number(dst?.avg_cost ?? item.unit_cost);
          const new_dst_avg = old_dst_soh <= 0
            ? Number(item.unit_cost)
            : (old_dst_avg * old_dst_soh + Number(item.unit_cost) * qty_rcvd) / (old_dst_soh + qty_rcvd);
          const new_dst_soh = old_dst_soh + qty_rcvd;
          await conn.execute(
            `UPDATE ims_stock SET qty_on_hand = ?, avg_cost = ? WHERE variant_id=? AND location_id=?`,
            [new_dst_soh, new_dst_avg, item.variant_id, bt.to_location_id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
             VALUES (?,?,'transfer_in','branch_transfer',?,?,?,?)`,
            [item.variant_id, bt.to_location_id, id, qty_rcvd, new_dst_soh, new_dst_avg]
          );
        }
        await conn.execute(`UPDATE ims_branch_transfers SET received_date = CURDATE() WHERE id = ?`, [id]);
      }

      await conn.execute(`UPDATE ims_branch_transfers SET status = ? WHERE id = ?`, [to, id]);
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
  },

  async delete(id: number): Promise<void> {
    await imsExecute(`DELETE FROM ims_branch_transfers WHERE id = ?`, [id]);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Shopify Sync
// ─────────────────────────────────────────────────────────────────────────────

export interface ImsShopifySyncLog {
  id: number;
  action: 'reconcile' | 'upload' | 'sync_prices' | 'resync';
  status: 'success' | 'error' | 'partial';
  summary: string;
  detail?: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Product Images
// ─────────────────────────────────────────────────────────────────────────────

export interface ImsProductImage {
  id: number;
  product_id: string;
  url: string;
  source: 'shopify' | 'google_drive' | 'external' | 'volume';
  drive_file_id?: string;
  is_primary: number;
  sort_order: number;
  alt_text?: string;
  created_at?: string;
}

export const ImsImagesRepo = {
  async list(productId: string): Promise<ImsProductImage[]> {
    return imsQuery<ImsProductImage>(
      `SELECT * FROM ims_product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC`,
      [productId],
    );
  },

  async get(id: number): Promise<ImsProductImage | null> {
    const rows = await imsQuery<ImsProductImage>(
      `SELECT * FROM ims_product_images WHERE id = ?`,
      [id],
    );
    return rows[0] ?? null;
  },

  async add(
    productId: string,
    url: string,
    source: ImsProductImage['source'],
    opts?: { driveFileId?: string; altText?: string; isPrimary?: boolean },
  ): Promise<number> {
    // Count existing — enforce max 5
    const rows = await imsQuery<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ims_product_images WHERE product_id = ?`,
      [productId],
    );
    if ((rows[0]?.cnt ?? 0) >= 5) throw new Error('Maximum of 5 images per product.');

    // If this is marked primary, demote any existing primary
    if (opts?.isPrimary) {
      await imsExecute(
        `UPDATE ims_product_images SET is_primary = 0 WHERE product_id = ?`,
        [productId],
      );
    }

    // Determine sort_order = max + 1
    const sortRows = await imsQuery<{ mx: number | null }>(
      `SELECT MAX(sort_order) AS mx FROM ims_product_images WHERE product_id = ?`,
      [productId],
    );
    const sortOrder = (sortRows[0]?.mx ?? -1) + 1;

    const res = await imsExecute(
      `INSERT INTO ims_product_images (product_id, url, source, drive_file_id, is_primary, sort_order, alt_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        productId, url, source,
        opts?.driveFileId ?? null,
        opts?.isPrimary ? 1 : 0,
        sortOrder,
        opts?.altText ?? null,
      ],
    );
    return (res as any).insertId;
  },

  async setPrimary(id: number, productId: string): Promise<void> {
    await imsExecute(
      `UPDATE ims_product_images SET is_primary = 0 WHERE product_id = ?`,
      [productId],
    );
    await imsExecute(
      `UPDATE ims_product_images SET is_primary = 1 WHERE id = ? AND product_id = ?`,
      [id, productId],
    );
  },

  async updateUrl(id: number, url: string): Promise<void> {
    await imsExecute(`UPDATE ims_product_images SET url = ? WHERE id = ?`, [url, id]);
  },

  async delete(id: number, productId: string): Promise<void> {
    await imsExecute(
      `DELETE FROM ims_product_images WHERE id = ? AND product_id = ?`,
      [id, productId],
    );
    // If we deleted the primary, promote the first remaining image
    await imsExecute(
      `UPDATE ims_product_images SET is_primary = 1
       WHERE product_id = ? AND is_primary = 0
       ORDER BY sort_order ASC LIMIT 1`,
      [productId],
    );
  },

  async reorder(productId: string, orderedIds: number[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await imsExecute(
        `UPDATE ims_product_images SET sort_order = ? WHERE id = ? AND product_id = ?`,
        [i, orderedIds[i], productId],
      );
    }
  },

  /** Upsert images from Shopify (by URL — idempotent). */
  async upsertFromShopify(
    productId: string,
    images: Array<{ src: string; alt?: string }>,
  ): Promise<void> {
    if (!images.length) return;
    // Clear existing shopify-sourced images for this product, replace with fresh ones
    await imsExecute(
      `DELETE FROM ims_product_images WHERE product_id = ? AND source = 'shopify'`,
      [productId],
    );
    for (let i = 0; i < Math.min(images.length, 5); i++) {
      await imsExecute(
        `INSERT INTO ims_product_images (product_id, url, source, is_primary, sort_order, alt_text)
         VALUES (?, ?, 'shopify', ?, ?, ?)`,
        [productId, images[i].src, i === 0 ? 1 : 0, i, images[i].alt ?? null],
      );
    }
  },
};

export const ImsShopifyRepo = {
  // ── Sync log ──────────────────────────────────────────────────────────────
  async logAction(
    action: ImsShopifySyncLog['action'],
    status: ImsShopifySyncLog['status'],
    summary: string,
    detail?: object,
  ): Promise<void> {
    await imsExecute(
      `INSERT INTO ims_shopify_sync_log (action, status, summary, detail) VALUES (?, ?, ?, ?)`,
      [action, status, summary, detail ? JSON.stringify(detail) : null],
    );
  },

  async getLog(limit = 50): Promise<ImsShopifySyncLog[]> {
    return imsQuery<ImsShopifySyncLog>(
      `SELECT * FROM ims_shopify_sync_log ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
  },

  // ── Status counts ─────────────────────────────────────────────────────────
  async getCounts(): Promise<{ linked: number; notInShopify: number; total: number }> {
    const rows = await imsQuery<{ linked: number; total: number }>(
      `SELECT
         COUNT(*) AS total,
         SUM(shopify_product_id IS NOT NULL) AS linked
       FROM ims_products WHERE is_active = 1`,
    );
    const { total = 0, linked = 0 } = rows[0] ?? {};
    return { linked: Number(linked), notInShopify: Number(total) - Number(linked), total: Number(total) };
  },

  // ── Link IDs after reconcile / upload ────────────────────────────────────
  async linkProduct(productId: string, shopifyProductId: string): Promise<void> {
    await imsExecute(
      `UPDATE ims_products SET shopify_product_id = ? WHERE product_id = ?`,
      [shopifyProductId, productId],
    );
  },

  async linkVariant(
    variantId: string,
    shopifyVariantId: string,
    shopifyInventoryItemId: string,
  ): Promise<void> {
    await imsExecute(
      `UPDATE ims_product_variants
         SET shopify_variant_id = ?, shopify_inventory_item_id = ?
       WHERE variant_id = ?`,
      [shopifyVariantId, shopifyInventoryItemId, variantId],
    );
  },

  // ── Products list with link status ───────────────────────────────────────
  async listWithShopifyStatus(): Promise<Array<ImsProduct & { shopify_status: 'linked' | 'not_in_shopify' }>> {
    const products = await imsQuery<any>(
      `SELECT p.*,
         IF(p.shopify_product_id IS NOT NULL, 'linked', 'not_in_shopify') AS shopify_status
       FROM ims_products p
       WHERE p.is_active = 1
       ORDER BY p.name`,
    );
    const variants = await imsQuery<ImsVariant>(
      `SELECT * FROM ims_product_variants WHERE is_active = 1 ORDER BY sku`,
    );
    const byProduct = new Map<string, ImsVariant[]>();
    for (const v of variants) {
      if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
      byProduct.get(v.product_id)!.push(v);
    }
    return products.map((p: any) => ({ ...p, variants: byProduct.get(p.product_id) ?? [] }));
  },
};

// ── PO Files ─────────────────────────────────────────────────────────────────

export interface ImsPoFile {
  id: number;
  po_id: number;
  business_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  uploaded_at: string;
}

/** Ensures the ims_po_files table exists (auto-migration on first use). */
async function ensurePoFilesTable(): Promise<void> {
  await imsExecute(
    `CREATE TABLE IF NOT EXISTS ims_po_files (
       id            INT AUTO_INCREMENT PRIMARY KEY,
       po_id         INT          NOT NULL,
       business_id   VARCHAR(100) NOT NULL,
       filename      VARCHAR(255) NOT NULL,
       original_name VARCHAR(255),
       mime_type     VARCHAR(100),
       file_size     INT,
       uploaded_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_po (po_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

export const ImsPoFilesRepo = {
  async list(poId: number): Promise<ImsPoFile[]> {
    await ensurePoFilesTable();
    return imsQuery<ImsPoFile>(
      `SELECT * FROM ims_po_files WHERE po_id = ? ORDER BY uploaded_at ASC`,
      [poId],
    );
  },

  async get(fileId: number): Promise<ImsPoFile | null> {
    await ensurePoFilesTable();
    const rows = await imsQuery<ImsPoFile>(
      `SELECT * FROM ims_po_files WHERE id = ?`,
      [fileId],
    );
    return rows[0] ?? null;
  },

  async add(
    poId: number,
    businessId: string,
    filename: string,
    originalName: string,
    mimeType: string,
    fileSize: number,
  ): Promise<number> {
    await ensurePoFilesTable();
    const res = await imsExecute(
      `INSERT INTO ims_po_files (po_id, business_id, filename, original_name, mime_type, file_size)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [poId, businessId, filename, originalName, mimeType, fileSize],
    );
    return (res as any).insertId;
  },

  async delete(fileId: number): Promise<void> {
    await imsExecute(`DELETE FROM ims_po_files WHERE id = ?`, [fileId]);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Payment Methods
// ─────────────────────────────────────────────────────────────────────────────

export const ImsPaymentMethodsRepo = {
  async list(businessId: string, type?: 'po' | 'so'): Promise<ImsPaymentMethod[]> {
    if (type) {
      return imsQuery<ImsPaymentMethod>(
        'SELECT * FROM ims_payment_methods WHERE business_id = ? AND type = ? ORDER BY sort_order ASC, name ASC',
        [businessId, type],
      );
    }
    return imsQuery<ImsPaymentMethod>(
      'SELECT * FROM ims_payment_methods WHERE business_id = ? ORDER BY sort_order ASC, name ASC',
      [businessId],
    );
  },

  async listActive(businessId: string, type?: 'po' | 'so'): Promise<ImsPaymentMethod[]> {
    if (type) {
      return imsQuery<ImsPaymentMethod>(
        'SELECT * FROM ims_payment_methods WHERE business_id = ? AND type = ? AND is_active = 1 ORDER BY sort_order ASC, name ASC',
        [businessId, type],
      );
    }
    return imsQuery<ImsPaymentMethod>(
      'SELECT * FROM ims_payment_methods WHERE business_id = ? AND is_active = 1 ORDER BY sort_order ASC, name ASC',
      [businessId],
    );
  },

  async create(businessId: string, data: { name: string; type: 'po' | 'so'; xero_account_code?: string; sort_order?: number }): Promise<ImsPaymentMethod> {
    const res = await imsExecute(
      'INSERT INTO ims_payment_methods (business_id, name, type, xero_account_code, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      [businessId, data.name, data.type, data.xero_account_code ?? '', data.sort_order ?? 0],
    );
    const rows = await imsQuery<ImsPaymentMethod>('SELECT * FROM ims_payment_methods WHERE id = ?', [(res as any).insertId]);
    return rows[0];
  },

  async update(id: number, businessId: string, data: Partial<{ name: string; xero_account_code: string; sort_order: number; is_active: boolean }>): Promise<void> {
    const fields: string[] = [];
    const vals: any[] = [];
    if (data.name !== undefined)               { fields.push('name = ?');               vals.push(data.name); }
    if (data.xero_account_code !== undefined)  { fields.push('xero_account_code = ?');  vals.push(data.xero_account_code); }
    if (data.sort_order !== undefined)         { fields.push('sort_order = ?');          vals.push(data.sort_order); }
    if (data.is_active !== undefined)          { fields.push('is_active = ?');           vals.push(data.is_active ? 1 : 0); }
    if (!fields.length) return;
    vals.push(id, businessId);
    await imsExecute(`UPDATE ims_payment_methods SET ${fields.join(', ')} WHERE id = ? AND business_id = ?`, vals);
  },

  async delete(id: number, businessId: string): Promise<void> {
    await imsExecute('DELETE FROM ims_payment_methods WHERE id = ? AND business_id = ?', [id, businessId]);
  },
};
