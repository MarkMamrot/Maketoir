import { v4 as uuidv4 } from 'uuid';
import { getIMSPool, imsQuery, imsExecute } from '@/services/IMSMySQLService';

// ─────────────────────────────────────────────────────────────────────────────
// Migration: avg_cost at variant level (business-wide weighted average)
// ─────────────────────────────────────────────────────────────────────────────
let _variantAvgCostReady = false;
/**
 * Lazily adds avg_cost to ims_product_variants and backfills it.
 * Runs at most once per server process (module-level flag).
 * MySQL 9.4 does not support ALTER TABLE … ADD COLUMN IF NOT EXISTS,
 * so we check with SHOW COLUMNS first.
 */
async function ensureVariantAvgCost(): Promise<void> {
  if (_variantAvgCostReady) return;
  try {
    const cols = await imsQuery<any>(`SHOW COLUMNS FROM ims_product_variants LIKE 'avg_cost'`);
    if (!cols.length) {
      await imsExecute(`ALTER TABLE ims_product_variants ADD COLUMN avg_cost DECIMAL(15,4) DEFAULT NULL AFTER cost_aud`);
      // Backfill: business-wide weighted avg from ims_stock, fall back to cost_aud
      await imsExecute(`
        UPDATE ims_product_variants pv
        SET pv.avg_cost = COALESCE(
          (SELECT SUM(s.qty_on_hand * s.avg_cost) / NULLIF(SUM(s.qty_on_hand), 0)
           FROM ims_stock s WHERE s.variant_id = pv.variant_id AND s.qty_on_hand > 0),
          pv.cost_aud
        )
        WHERE pv.avg_cost IS NULL
      `);
    }
  } catch { /* column may already exist — safe to ignore */ }
  _variantAvgCostReady = true;
}

/**
 * After updating ims_stock.avg_cost for one location, recomputes the
 * business-wide weighted average across ALL locations and writes it to
 * ims_product_variants.avg_cost. Called inside a transaction conn.
 * Never throws — must never block a receive operation.
 */
async function refreshVariantAvgCost(conn: any, variantId: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await conn.execute(
      `SELECT SUM(qty_on_hand * avg_cost) AS total_value, SUM(qty_on_hand) AS total_qty
       FROM ims_stock WHERE variant_id = ? AND qty_on_hand > 0`,
      [variantId]
    );
    const agg = result[0][0];
    const totalQty = Number(agg?.total_qty ?? 0);
    if (totalQty > 0) {
      const newAvg = Math.round((Number(agg.total_value) / totalQty) * 10000) / 10000;
      await conn.execute(
        `UPDATE ims_product_variants SET avg_cost = ? WHERE variant_id = ?`,
        [newAvg, variantId]
      );
    }
  } catch { /* non-critical — must never block a receive */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ContactType = 'supplier' | 'customer' | 'both';
export type POStatus    = 'draft' | 'confirmed' | 'partially_received' | 'complete' | 'cancelled';
export type SOStatus    = 'draft' | 'confirmed' | 'fulfilled' | 'cancelled';

export interface ImsContact {
  id: number; type: ContactType; name: string; company?: string;
  email?: string; phone?: string; address?: string; city?: string;
  state?: string; postcode?: string; country?: string; notes?: string;
  lead_time_days?: number; order_frequency_days?: number; cin7_supplier_id?: number; cin7_contact_id?: number;
  is_active: number; price_tier?: string;
  charges_tax?: number; prices_include_tax?: number; tax_rate?: number;
  website_url?: string;
  created_at?: string; updated_at?: string;
}

export interface ImsLocation {
  id: number; name: string; code?: string; address?: string; phone?: string;
  city?: string; state?: string; postcode?: string; country?: string;
  cin7_branch_id?: number; pos_pin?: string;
  has_pos?: number; has_wholesale?: number; has_online?: number;
  is_active: number; created_at?: string; updated_at?: string;
}

export interface ImsProduct {
  id: number; product_id: string; name: string; description?: string;
  product_type?: string; brand?: string; tags?: string; category?: string; subcategory?: string;
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
  available?: number; // computed: qty_on_hand - qty_committed
  min_qty: number; reorder_qty: number; avg_cost?: number; updated_at?: string;
  zone?: string | null; bin?: string | null;
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
  shopify_line_item_id?: number | string | null;
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
  const rows = await imsQuery<{ max_seq: number | null }>(
    `SELECT MAX(CAST(SUBSTRING_INDEX(po_number, '-', -1) AS UNSIGNED)) AS max_seq
     FROM ims_purchase_orders
     WHERE po_number LIKE ?`,
    [`PO-${year}-%`]
  );
  const seq = String((rows[0]?.max_seq ?? 0) + 1).padStart(4, '0');
  return `PO-${year}-${seq}`;
}

async function nextSONumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await imsQuery<{ max_seq: number | null }>(
    `SELECT MAX(CAST(SUBSTRING_INDEX(so_number, '-', -1) AS UNSIGNED)) AS max_seq
     FROM ims_sales_orders
     WHERE so_number LIKE ?`,
    [`SO-${year}-%`]
  );
  const seq = String((rows[0]?.max_seq ?? 0) + 1).padStart(4, '0');
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
      `INSERT INTO ims_contacts (business_id,type,name,company,email,phone,address,city,state,postcode,country,notes,is_active,cin7_supplier_id,lead_time_days,order_frequency_days,price_tier,charges_tax,prices_include_tax,tax_rate,website_url)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [businessId ?? '', data.type, data.name, data.company, data.email, data.phone,
       data.address, data.city, data.state, data.postcode, data.country,
       data.notes, data.is_active ?? 1, data.cin7_supplier_id ?? null, data.lead_time_days ?? null,
       data.order_frequency_days ?? 45,
       data.price_tier ?? 'retail',
       data.charges_tax ?? 1, data.prices_include_tax ?? 0, data.tax_rate ?? null,
       data.website_url ?? null]
    );
    return res.insertId;
  },

  async update(id: number, data: Partial<ImsContact>): Promise<void> {
    const fields = ['type','name','company','email','phone','address','city','state','postcode','country','notes','is_active','cin7_supplier_id','lead_time_days','order_frequency_days','price_tier','charges_tax','prices_include_tax','tax_rate','website_url'];
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
      `INSERT INTO ims_locations (business_id,name,code,address,phone,city,state,postcode,country,is_active,cin7_branch_id,has_pos,has_wholesale,has_online)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [businessId ?? '', data.name, data.code, data.address, data.phone ?? null, data.city, data.state,
       data.postcode, data.country, data.is_active ?? 1, data.cin7_branch_id ?? null,
       data.has_pos ?? 0, data.has_wholesale ?? 0, data.has_online ?? 0]
    );
    return res.insertId;
  },

  async update(id: number, data: Partial<ImsLocation>): Promise<void> {
    const fields = ['name','code','address','phone','city','state','postcode','country','is_active','cin7_branch_id','pos_pin','has_pos','has_wholesale','has_online'];
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
      `INSERT INTO ims_products (business_id,product_id,name,description,product_type,brand,tags,category,subcategory,is_active,shopify_product_id,style_code,is_online,supplier_contact_id,cin7_product_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [businessId ?? '', product_id, data.name, data.description ?? null, data.product_type ?? null, data.brand ?? null,
       data.tags ?? null, data.category ?? null, data.subcategory ?? null, data.is_active ?? 1, data.shopify_product_id ?? null,
       data.style_code ?? null, data.is_online ?? 1, data.supplier_contact_id ?? null, data.cin7_product_id ?? null]
    );
    return product_id;
  },

  async update(productId: string, data: Partial<ImsProduct>): Promise<void> {
    const fields = ['name','description','product_type','brand','tags','category','subcategory','is_active','shopify_product_id','style_code','is_online','supplier_contact_id','cin7_product_id'];
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

  /** Returns { productId: primaryImageUrl } for products that have at least one image.
   *  Pass `ids` to restrict to a specific set of product IDs (current-page optimisation). */
  async listPrimaryImages(businessId?: string, ids?: string[]): Promise<Record<string, string>> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (businessId) { conditions.push('p.business_id = ?'); params.push(businessId); }
    if (ids?.length) {
      conditions.push(`p.product_id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await imsQuery<{ product_id: string; url: string }>(
      `SELECT p.product_id,
         (SELECT url FROM ims_product_images
          WHERE product_id = p.product_id COLLATE utf8mb4_general_ci
          ORDER BY is_primary DESC, sort_order ASC LIMIT 1) AS url
       FROM ims_products p
       ${where}
       HAVING url IS NOT NULL`,
      params,
    );
    const map: Record<string, string> = {};
    for (const r of rows) map[r.product_id] = r.url;
    return map;
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

  async create(
    data: Omit<ImsVariant, 'id' | 'created_at' | 'updated_at' | 'product_name'>,
    businessId?: string
  ): Promise<string> {
    const variant_id = data.variant_id || uuidv4();
    await imsExecute(
      `INSERT INTO ims_product_variants
         (variant_id,product_id,business_id,sku,barcode,option1_name,option1_value,
          option2_name,option2_value,option3_name,option3_value,
          cost_aud,price_rrp,price_wholesale,price_rrp_sale,discount_start_date,discount_end_date,
          weight_kg,shopify_variant_id,is_active,cost_foreign,pack_size,cin7_option_id,bin,zone)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [variant_id, data.product_id, businessId ?? '', data.sku ?? null, data.barcode ?? null,
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
  async list(businessId?: string): Promise<{ id: number; name: string; website_url: string | null; created_at: string }[]> {
    const where = businessId ? 'WHERE business_id = ?' : '';
    const params = businessId ? [businessId] : [];
    return imsQuery(`SELECT id, name, website_url, created_at FROM ims_brands ${where} ORDER BY name`, params);
  },

  async create(name: string, businessId?: string): Promise<number> {
    const res = await imsExecute('INSERT INTO ims_brands (business_id, name) VALUES (?, ?)', [businessId ?? '', name.trim()]);
    return (res as any).insertId;
  },

  async update(id: number, name: string, websiteUrl?: string | null): Promise<void> {
    await imsExecute(
      'UPDATE ims_brands SET name = ?, website_url = ? WHERE id = ?',
      [name.trim(), websiteUrl !== undefined ? (websiteUrl || null) : null, id]
    );
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
                (s.qty_on_hand - s.qty_committed) AS available,
                v.sku, v.barcode, p.name AS product_name,
                p.brand AS brand,
                COALESCE(NULLIF(s.zone,''), p.zone) AS zone,
                COALESCE(NULLIF(s.bin, ''), p.bin)  AS bin,
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
                (s.qty_on_hand - s.qty_committed) AS available,
                v.sku, v.barcode, p.name AS product_name,
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

  /** Add zone/bin to ims_stock if they don't exist yet (idempotent, runs once per process). */
  async ensureZoneBinColumns(): Promise<void> {
    try {
      // Use SHOW COLUMNS for compatibility with all MySQL versions.
      const cols = await imsQuery<{ Field: string }>('SHOW COLUMNS FROM ims_stock', []);
      const names = new Set(cols.map(c => c.Field));
      if (!names.has('zone')) await imsExecute('ALTER TABLE ims_stock ADD COLUMN zone VARCHAR(50) NULL', []);
      if (!names.has('bin'))  await imsExecute('ALTER TABLE ims_stock ADD COLUMN bin  VARCHAR(50) NULL', []);
    } catch { /* ignore — column already exists or table not yet created */ }
  },

  /** Add category/subcategory to ims_products if they don't exist yet (idempotent, runs once per process). */
  async ensureProductCategoryColumns(): Promise<void> {
    if ((ImsStockRepo as any)._productCatColsEnsured) return;
    (ImsStockRepo as any)._productCatColsEnsured = true;
    try {
      const cols = await imsQuery<{ Field: string }>('SHOW COLUMNS FROM ims_products', []);
      const names = new Set(cols.map(c => c.Field));
      if (!names.has('category'))    await imsExecute('ALTER TABLE ims_products ADD COLUMN category    VARCHAR(255) NULL', []);
      if (!names.has('subcategory')) await imsExecute('ALTER TABLE ims_products ADD COLUMN subcategory VARCHAR(255) NULL', []);
    } catch { /* ignore */ }
  },

  async upsert(variantId: string, locationId: number, data: Partial<ImsStock>): Promise<void> {
    // Build the ON DUPLICATE KEY UPDATE clause from only the fields that were explicitly passed,
    // so a zone/bin-only call never overwrites existing min_qty / reorder_qty values.
    const onUpdate: string[] = [];
    const insertCols: string[] = ['variant_id', 'location_id', 'min_qty', 'reorder_qty'];
    const insertVals: any[]   = [variantId, locationId, data.min_qty ?? 0, data.reorder_qty ?? 0];
    if (data.min_qty     !== undefined) onUpdate.push('min_qty = VALUES(min_qty)');
    if (data.reorder_qty !== undefined) onUpdate.push('reorder_qty = VALUES(reorder_qty)');
    if (data.zone        !== undefined) { onUpdate.push('zone = VALUES(zone)'); insertCols.push('zone'); insertVals.push(data.zone); }
    if (data.bin         !== undefined) { onUpdate.push('bin = VALUES(bin)');   insertCols.push('bin');  insertVals.push(data.bin);  }
    if (onUpdate.length === 0) return; // nothing to do
    const ph = insertCols.map(() => '?').join(', ');
    await imsExecute(
      `INSERT INTO ims_stock (${insertCols.join(', ')}) VALUES (${ph})
       ON DUPLICATE KEY UPDATE ${onUpdate.join(', ')}`,
      insertVals,
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
    await ensureVariantAvgCost(); // ensures avg_cost column exists before any receive writes it
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
            `INSERT INTO ims_stock (variant_id, location_id, business_id, qty_incoming)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE qty_incoming = qty_incoming + VALUES(qty_incoming)`,
            [item.variant_id, po.location_id, po.business_id, item.qty_ordered]
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

      // ── confirmed → complete ───────────────────────────────────
      if (from === 'confirmed' && to === 'complete') {
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
          // Guard against double-receiving: only receive the outstanding quantity.
          // If items were already (partially) received via the device receive flow,
          // qty_received > 0 — never add the full qty_ordered again on top of it.
          const alreadyRcvd = Number(item.qty_received ?? 0);
          if (alreadyRcvd >= Number(item.qty_ordered)) {
            await conn.execute(
              `UPDATE ims_purchase_order_items SET qty_received = qty_ordered WHERE id = ?`,
              [item.id]
            );
            continue; // already fully received — nothing more to add
          }

          await conn.execute(
            `INSERT IGNORE INTO ims_stock (variant_id, location_id, business_id) VALUES (?, ?, ?)`,
            [item.variant_id, po.location_id, po.business_id]
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
          const qty_rcvd  = Number(item.qty_ordered) - alreadyRcvd; // outstanding only
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
          if (item.variant_id !== null) await refreshVariantAvgCost(conn, item.variant_id); // keep variant-level avg in sync
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

      // ── partially_received → complete (force-close a partially received PO from IMS) ───────────
      if (from === 'partially_received' && to === 'complete') {
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
            `INSERT IGNORE INTO ims_stock (variant_id, location_id, business_id) VALUES (?, ?, ?)`,
            [item.variant_id, po.location_id, po.business_id]
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
          if (item.variant_id !== null) await refreshVariantAvgCost(conn, item.variant_id); // keep variant-level avg in sync
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

      // ── complete → confirmed (revert a fully received PO) ─────────────────────
      if (from === 'complete' && to === 'confirmed') {
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
    await ensureVariantAvgCost(); // ensure avg_cost column exists before reading it
    const items = await imsQuery<ImsSOItem>(
      `SELECT i.*,
              COALESCE(v.sku, i.code) AS sku,
              COALESCE(p.name, i.name, i.notes) AS product_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''),
                NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')
              ) AS variant_label,
              COALESCE(v.avg_cost, v.cost_aud) AS unit_cost
       FROM ims_sales_order_items i
       LEFT JOIN ims_product_variants v ON v.variant_id = i.variant_id
       LEFT JOIN ims_products p ON p.product_id = v.product_id
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
      const disc  = 1 - Number(item.discount_pct ?? 0) / 100;
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
      const disc      = 1 - Number(item.discount_pct ?? 0) / 100;
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

      // Snapshot BEFORE any change. When the order is already 'confirmed', its
      // qty_committed reflects the OLD lines at the OLD location; replacing the
      // lines below would strand that commitment, so we rebalance it here.
      const [[preEdit]] = await conn.execute<any[]>(
        `SELECT status, location_id, business_id FROM ims_sales_orders WHERE id = ?`, [id]
      );
      const rebalanceCommitted = !!items && preEdit?.status === 'confirmed';
      let oldCommitItems: any[] = [];
      if (rebalanceCommitted) {
        [oldCommitItems] = await conn.execute<any[]>(
          `SELECT variant_id, qty_ordered FROM ims_sales_order_items WHERE so_id = ?`, [id]
        );
      }

      if (sets.length) {
        vals.push(id);
        await conn.execute(`UPDATE ims_sales_orders SET ${sets.join(', ')} WHERE id = ?`, vals);
      }

      if (items) {
        await conn.execute(`DELETE FROM ims_sales_order_items WHERE so_id = ?`, [id]);
        let subtotal = 0, tax_amount = 0;
        for (const item of items) {
          const disc      = 1 - Number(item.discount_pct ?? 0) / 100;
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

        // Rebalance committed for a confirmed order: release the OLD lines'
        // commitment (at the OLD location), then commit the NEW lines (at the
        // possibly-changed location). Skips null-variant lines.
        if (rebalanceCommitted) {
          const oldLoc = preEdit.location_id;
          const newLoc = (data.location_id != null) ? data.location_id : preEdit.location_id;
          for (const oi of oldCommitItems) {
            if (!oi.variant_id) continue;
            await conn.execute(
              `UPDATE ims_stock SET qty_committed = GREATEST(0, qty_committed - ?)
               WHERE variant_id = ? AND location_id = ?`,
              [oi.qty_ordered, oi.variant_id, oldLoc]
            );
          }
          for (const item of items) {
            if (!item.variant_id) continue;
            await conn.execute(
              `INSERT INTO ims_stock (variant_id, location_id, business_id, qty_committed)
               VALUES (?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE qty_committed = qty_committed + VALUES(qty_committed)`,
              [item.variant_id, newLoc, preEdit.business_id, item.qty_ordered]
            );
          }
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
            `INSERT INTO ims_stock (variant_id, location_id, business_id, qty_committed)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE qty_committed = qty_committed + VALUES(qty_committed)`,
            [item.variant_id, so.location_id, so.business_id, item.qty_ordered]
          );
          const [[s]] = await conn.execute<any[]>(
            `SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?`,
            [item.variant_id, so.location_id]
          );
          await conn.execute(
            `INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,channel,reference_type,reference_id,qty_change,qty_after_soh)
             VALUES (?,?,'so_confirmed',?,'sales_order',?,?,?)`,
            [item.variant_id, so.location_id, so.so_type === 'online' ? 'online' : 'wholesale', id, 0, s?.qty_on_hand ?? 0]
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
               (variant_id,location_id,movement_type,channel,reference_type,reference_id,qty_change,qty_after_soh)
             VALUES (?,?,'so_unconfirmed',?,'sales_order',?,?,?)`,
            [item.variant_id, so.location_id, so.so_type === 'online' ? 'online' : 'wholesale', id, 0, s?.qty_on_hand ?? 0]
          );
        }
      }

      // ── confirmed → fulfilled ────────────────────────────────
      if (from === 'confirmed' && to === 'fulfilled') {
        for (const item of items) {
          await conn.execute(
            `INSERT IGNORE INTO ims_stock (variant_id, location_id, business_id) VALUES (?, ?, ?)`,
            [item.variant_id, so.location_id, so.business_id]
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
               (variant_id,location_id,movement_type,channel,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
             VALUES (?,?,'so_fulfilled',?,'sales_order',?,?,?,?)`,
            [item.variant_id, so.location_id, so.so_type === 'online' ? 'online' : 'wholesale', id, -qty, new_soh, avg_cost]
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

  /**
   * Process a Shopify refund against an existing sales order.
   * Idempotent (keyed on shopify_refund_id). Restocks returned line items into
   * the SO's location and records the refunded $ against the order.
   *
   * `restockLines[].shopifyVariantId` maps back to the IMS variant via
   * ims_product_variants.shopify_variant_id. Lines with restock=false (Shopify
   * restock_type 'no_restock') are money-only and do NOT touch stock.
   */
  async processShopifyRefund(
    businessId: string,
    opts: {
      soId: number;
      shopifyRefundId: string;
      shopifyReturnId?: string | null;  // if present, complete an existing awaiting_product CN
      gateway?: string | null;
      amount: number;
      taxAmount?: number;
      note?: string;
      restockLines: {
        shopifyVariantId: string;
        quantity: number;
        restock: boolean;
        unitPrice?: number;
        taxAmount?: number;
        name?: string | null;
        sku?: string | null;
      }[];
    },
  ): Promise<{ processed: boolean; restocked: number }> {
    // A Shopify refund becomes a source='shopify', status='complete' credit note
    // linked to the sales order. Idempotent on shopify_refund_id (unique key).
    // Xero is intentionally NOT posted here — Shopify Payments refunds are
    // accounted for via the payout reconciliation (net of refunds).
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [[so]] = await conn.execute<any[]>(
        `SELECT id, location_id, so_type, so_number, customer_id FROM ims_sales_orders WHERE id = ? AND business_id = ?`,
        [opts.soId, businessId],
      );
      if (!so) { await conn.rollback(); return { processed: false, restocked: 0 }; }

      // Resolve Shopify variants → IMS variants and build credit-note line items.
      const cnItems: {
        variant_id: string | null; code: string | null; name: string | null;
        qty: number; unit_price: number; tax_rate: number; restock: number;
      }[] = [];
      for (const line of opts.restockLines ?? []) {
        const qty = Number(line.quantity);
        if (!(qty > 0)) continue;
        let variantId: string | null = null;
        let sku: string | null = line.sku ?? null;
        if (line.shopifyVariantId) {
          const [[v]] = await conn.execute<any[]>(
            `SELECT v.variant_id, v.sku FROM ims_product_variants v
               JOIN ims_products p ON p.product_id = v.product_id
             WHERE p.business_id = ? AND v.shopify_variant_id = ? LIMIT 1`,
            [businessId, String(line.shopifyVariantId)],
          );
          if (v) { variantId = v.variant_id; sku = sku ?? v.sku; }
        }
        const unitPrice = Number(line.unitPrice ?? 0);
        const lineBase = unitPrice * qty;
        const taxRate = lineBase > 0 ? Number(line.taxAmount ?? 0) / lineBase : 0;
        cnItems.push({
          variant_id: variantId,
          code: sku,
          name: line.name ?? null,
          qty,
          unit_price: Math.round(unitPrice * 10000) / 10000,
          tax_rate: Math.round(taxRate * 10000) / 10000,
          restock: line.restock ? 1 : 0,
        });
      }

      // Totals from the refund (authoritative money figures).
      const total = Math.round((opts.amount ?? 0) * 100) / 100;
      const tax   = Math.round((opts.taxAmount ?? 0) * 100) / 100;
      const subtotal = Math.round((total - tax) * 100) / 100;

      // If Shopify sent no itemised lines, record a single summary line.
      if (cnItems.length === 0) {
        const taxRate = subtotal > 0 ? tax / subtotal : 0;
        cnItems.push({
          variant_id: null,
          code: null,
          name: `Shopify refund ${opts.shopifyRefundId}`,
          qty: 1,
          unit_price: subtotal,
          tax_rate: Math.round(taxRate * 10000) / 10000,
          restock: 0,
        });
      }

      // ── Case A: this refund is linked to an approved return in Shopify ──────
      // If there's an awaiting_product CN created from a returns/approve webhook,
      // complete it with the actual refund amounts rather than creating a duplicate.
      if (opts.shopifyReturnId) {
        const [pending] = await conn.execute<any[]>(
          `SELECT id, location_id FROM ims_credit_notes
            WHERE business_id = ? AND shopify_return_id = ? AND status = 'awaiting_product' LIMIT 1`,
          [businessId, String(opts.shopifyReturnId)],
        );
        const existingCn = (pending as any[])[0];
        if (existingCn) {
          // Update the CN amounts from the refund (authoritative), link to refund id, and complete.
          const total = Math.round((opts.amount ?? 0) * 100) / 100;
          const tax   = Math.round((opts.taxAmount ?? 0) * 100) / 100;
          const subtotal = Math.round((total - tax) * 100) / 100;
          await conn.execute(
            `UPDATE ims_credit_notes
                SET shopify_refund_id = ?, subtotal = ?, tax_amount = ?, total_amount = ?,
                    status = 'complete', completed_at = NOW()
              WHERE id = ?`,
            [String(opts.shopifyRefundId), subtotal, tax, total, existingCn.id],
          );
          // Delete old items and re-insert from actual refund data.
          await conn.execute(`DELETE FROM ims_credit_note_items WHERE cn_id = ?`, [existingCn.id]);
          for (const it of cnItems) {
            const lt = Math.round(it.qty * it.unit_price * 100) / 100;
            await conn.execute(
              `INSERT INTO ims_credit_note_items (cn_id,variant_id,code,name,qty,unit_price,price_basis,restock,tax_rate,line_total) VALUES (?,?,?,?,?,?,'custom',?,?,?)`,
              [existingCn.id, it.variant_id, it.code, it.name, it.qty, it.unit_price, it.restock, it.tax_rate, lt],
            );
          }
          const existingItems: ImsCNItem[] = cnItems.map(it => ({ ...it, id: 0, cn_id: existingCn.id, price_basis: 'custom' as const, line_total: Math.round(it.qty * it.unit_price * 100) / 100 }));
          const channel = so.so_type === 'online' ? 'online' : 'wholesale';
          await restockCreditNoteItemsTx(conn, existingCn.id, so.location_id, existingItems, channel);
          const restocked = existingItems.reduce((s, it) => s + (Number(it.restock) ? Number(it.qty) : 0), 0);
          await conn.execute(
            `UPDATE ims_sales_orders SET refunded_amount = COALESCE(refunded_amount,0)+?, returned_at = CASE WHEN ?> 0 THEN NOW() ELSE returned_at END WHERE id = ?`,
            [total, restocked, opts.soId],
          );
          await conn.commit();
          return { processed: true, restocked };
        }
      }

      // ── Case B: no linked return — create and complete a new CN ──────────────
      const [[mx]] = await conn.execute<any[]>(
        `SELECT MAX(CAST(REGEXP_REPLACE(cn_number,'[^0-9]','') AS UNSIGNED)) AS m FROM ims_credit_notes WHERE business_id = ?`,
        [businessId],
      );
      const cnNumber = `CN-${String(Number(mx?.m ?? 0) + 1).padStart(5, '0')}`;
      const cnDate = new Date().toISOString().slice(0, 10);

      // Idempotency: INSERT IGNORE on the unique (business_id, shopify_refund_id).
      const [ins] = await conn.execute<any>(
        `INSERT IGNORE INTO ims_credit_notes
           (business_id, cn_number, customer_id, so_id, original_so_number, location_id,
            status, source, shopify_refund_id, cn_date, completed_at, reference,
            tax_treatment, subtotal, tax_amount, total_amount, notes)
         VALUES (?,?,?,?,?,?, 'complete','shopify',?, ?, NOW(), ?, 'inc_tax', ?, ?, ?, ?)`,
        [businessId, cnNumber, so.customer_id ?? null, so.id, so.so_number ?? null, so.location_id,
         String(opts.shopifyRefundId), cnDate,
         `Shopify refund ${opts.shopifyRefundId}`, subtotal, tax, total,
         opts.note ?? `Shopify refund${opts.gateway ? ` via ${opts.gateway}` : ''}`],
      );
      if (!ins.affectedRows) { await conn.rollback(); return { processed: false, restocked: 0 }; }
      const cnId = ins.insertId;

      const cnItemRows: ImsCNItem[] = [];
      for (const it of cnItems) {
        const lineTotal = Math.round(it.qty * it.unit_price * 100) / 100;
        await conn.execute(
          `INSERT INTO ims_credit_note_items
             (cn_id,variant_id,code,name,qty,unit_price,price_basis,restock,tax_rate,line_total)
           VALUES (?,?,?,?,?,?, 'custom', ?,?,?)`,
          [cnId, it.variant_id, it.code, it.name, it.qty, it.unit_price, it.restock, it.tax_rate, lineTotal],
        );
        cnItemRows.push({ ...it, id: 0, cn_id: cnId, price_basis: 'custom', line_total: lineTotal } as ImsCNItem);
      }

      // Restock the returnable lines.
      const channel = so.so_type === 'online' ? 'online' : 'wholesale';
      await restockCreditNoteItemsTx(conn, cnId, so.location_id, cnItemRows, channel);
      const restocked = cnItemRows.reduce((s, it) => s + (Number(it.restock) ? Number(it.qty) : 0), 0);

      // Reflect the refund on the sales order.
      await conn.execute(
        `UPDATE ims_sales_orders
           SET refunded_amount = COALESCE(refunded_amount, 0) + ?,
               returned_at = CASE WHEN ? > 0 THEN NOW() ELSE returned_at END
         WHERE id = ?`,
        [total, restocked, opts.soId],
      );

      await conn.commit();
      return { processed: true, restocked };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard stats

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
    const [soh] = await imsQuery<{ stock_value: number; stock_item_count: number }>(
      `SELECT COALESCE(SUM(CASE WHEN qty_on_hand > 0 THEN qty_on_hand * avg_cost ELSE 0 END), 0) AS stock_value,
              COUNT(CASE WHEN qty_on_hand > 0 THEN 1 END) AS stock_item_count
       FROM ims_stock
       ${businessId ? 'WHERE business_id = ?' : ''}`, p
    );
    const tz = process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney';
    const todayAEST = new Date().toLocaleDateString('sv-SE', { timeZone: tz });

    const posRegisters = await imsQuery<{
      id: number; register_name: string; location_name: string; status: string;
      opened_at: string; opened_by: string | null; opening_float: string | null;
      closed_at: string | null; closed_by: string | null;
    }>(
      `SELECT prs.id, pr.name AS register_name, l.name AS location_name,
              prs.status, prs.opened_at, prs.opened_by, prs.opening_float,
              prs.closed_at, prs.closed_by
       FROM pos_register_sessions prs
       JOIN pos_registers pr ON pr.id = prs.register_id
       JOIN ims_locations l ON l.id = prs.location_id
       WHERE prs.session_date = ?
       ${businessId ? 'AND l.business_id = ?' : ''}
       ORDER BY l.name, prs.opened_at ASC`,
      businessId ? [todayAEST, businessId] : [todayAEST]
    );

    // Fetch EOD close totals per payment type for each session
    const sessionIds = posRegisters.map(s => s.id);
    let reconRows: { register_session_id: number; payment_method: string; counted_amount: string }[] = [];
    if (sessionIds.length > 0) {
      reconRows = await imsQuery<{ register_session_id: number; payment_method: string; counted_amount: string }>(
        `SELECT register_session_id, payment_method, counted_amount
         FROM pos_eod_reconciliations
         WHERE register_session_id IN (${sessionIds.map(() => '?').join(',')})
           AND counted_amount IS NOT NULL
         ORDER BY register_session_id, payment_method`,
        sessionIds
      );
    }
    // Group reconciliation rows by session id
    const reconBySession = new Map<number, { payment_method: string; counted_amount: string }[]>();
    for (const r of reconRows) {
      if (!reconBySession.has(r.register_session_id)) reconBySession.set(r.register_session_id, []);
      reconBySession.get(r.register_session_id)!.push({ payment_method: r.payment_method, counted_amount: r.counted_amount });
    }
    const posRegistersWithTotals = posRegisters.map(s => ({
      ...s,
      close_totals: reconBySession.get(s.id) ?? [],
    }));
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
      products:       products?.cnt  ?? 0,
      variants:       variants?.cnt  ?? 0,
      locations:      locations?.cnt ?? 0,
      openPOs:        openPOs?.cnt   ?? 0,
      openSOs:        openSOs?.cnt   ?? 0,
      lowStock:       lowStock?.cnt  ?? 0,
      stockValue:     Number(soh?.stock_value     ?? 0),
      stockItemCount: Number(soh?.stock_item_count ?? 0),
      openRegisters:  posRegistersWithTotals.filter(r => r.status === 'open'),
      posRegisters:   posRegistersWithTotals,
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
          varWheres.push('p.supplier_contact_id = ?');
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
      varWheres.push('p.supplier_contact_id = ?');
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

export type BTStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';

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
  const rows = await imsQuery<{ max_seq: number | null }>(
    `SELECT MAX(CAST(SUBSTRING_INDEX(transfer_number, '-', -1) AS UNSIGNED)) AS max_seq
     FROM ims_branch_transfers
     WHERE transfer_number LIKE ?`,
    [`BT-${year}-%`]
  );
  const seq = String((rows[0]?.max_seq ?? 0) + 1).padStart(4, '0');
  return `BT-${year}-${seq}`;
}

/**
 * Move stock between the two branches of a transfer and record the matching
 * stock movements. `qty` is SIGNED relative to the transfer direction:
 *   qty > 0 → source → destination (a receipt / top-up)
 *   qty < 0 → destination → source (reverse an over-receipt or a deletion)
 * The gaining location's avg_cost is recomputed; the losing location's is left
 * unchanged (consistent with how stock leaves on a normal transfer out).
 * Must be called inside an open transaction (`conn`).
 */
async function _btMove(
  conn: any,
  bt: { from_location_id: number; to_location_id: number },
  refId: number,
  item: { variant_id: string; unit_cost: number },
  qty: number,
): Promise<void> {
  if (!qty) return;
  const variantId = item.variant_id;
  const unitCost  = Number(item.unit_cost);
  const loseLoc   = qty > 0 ? bt.from_location_id : bt.to_location_id;
  const gainLoc   = qty > 0 ? bt.to_location_id   : bt.from_location_id;
  const mag       = Math.abs(qty);

  // ── Losing location (stock leaves) ──
  await conn.execute(`INSERT IGNORE INTO ims_stock (variant_id, location_id, qty_on_hand) VALUES (?, ?, 0)`, [variantId, loseLoc]);
  const [[lose]] = await conn.execute(`SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?`, [variantId, loseLoc]);
  const loseNew = Number(lose?.qty_on_hand ?? 0) - mag;
  await conn.execute(`UPDATE ims_stock SET qty_on_hand = ? WHERE variant_id=? AND location_id=?`, [loseNew, variantId, loseLoc]);
  await conn.execute(
    `INSERT INTO ims_stock_movements
       (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
     VALUES (?,?,'transfer_out','branch_transfer',?,?,?,?)`,
    [variantId, loseLoc, refId, -mag, loseNew, unitCost]
  );

  // ── Gaining location (stock arrives) ──
  await conn.execute(`INSERT IGNORE INTO ims_stock (variant_id, location_id, qty_on_hand) VALUES (?, ?, 0)`, [variantId, gainLoc]);
  const [[gain]] = await conn.execute(`SELECT qty_on_hand, avg_cost FROM ims_stock WHERE variant_id=? AND location_id=?`, [variantId, gainLoc]);
  const gainSoh = Number(gain?.qty_on_hand ?? 0);
  const gainAvg = Number(gain?.avg_cost ?? unitCost);
  const newAvg  = gainSoh <= 0 ? unitCost : (gainAvg * gainSoh + unitCost * mag) / (gainSoh + mag);
  const gainNew = gainSoh + mag;
  await conn.execute(`UPDATE ims_stock SET qty_on_hand = ?, avg_cost = ? WHERE variant_id=? AND location_id=?`, [gainNew, newAvg, variantId, gainLoc]);
  await conn.execute(
    `INSERT INTO ims_stock_movements
       (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
     VALUES (?,?,'transfer_in','branch_transfer',?,?,?,?)`,
    [variantId, gainLoc, refId, mag, gainNew, newAvg]
  );
}

export const ImsBTRepo = {
  async list(status?: BTStatus | BTStatus[]): Promise<ImsBT[]> {
    let where = '';
    let params: any[] = [];
    if (status) {
      const statuses = Array.isArray(status) ? status : [status];
      where = `WHERE bt.status IN (${statuses.map(() => '?').join(',')})`;
      params = statuses;
    }
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
              v.price_rrp_sale, v.discount_start_date, v.discount_end_date,
              p.name AS product_name,
              p.brand,
              p.zone,
              p.bin,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''), NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')) AS variant_label
         FROM ims_branch_transfer_items bti
         JOIN ims_product_variants v ON v.variant_id = bti.variant_id
         JOIN ims_products p ON p.product_id = v.product_id
         WHERE bti.transfer_id = ?
         ORDER BY
           COALESCE(NULLIF(TRIM(p.zone),''), '~~~'),
           COALESCE(NULLIF(TRIM(p.bin),''),  '~~~'),
           COALESCE(NULLIF(TRIM(p.brand),''), '~~~'),
           p.name`,
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

      // Snapshot BEFORE any change. A 'sent' transfer holds qty_committed at its
      // OLD source; replacing the lines would strand it, so rebalance here.
      const [[preEdit]] = await conn.execute<any[]>(
        `SELECT status, from_location_id FROM ims_branch_transfers WHERE id = ?`, [id]
      );
      const rebalanceCommitted = !!items && preEdit?.status === 'sent';
      let oldCommitItems: any[] = [];
      if (rebalanceCommitted) {
        [oldCommitItems] = await conn.execute<any[]>(
          `SELECT variant_id, qty_sent FROM ims_branch_transfer_items WHERE transfer_id = ?`, [id]
        );
      }

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

        // Rebalance committed for a 'sent' transfer: release the OLD lines at the
        // OLD source, then re-commit the NEW lines at the (possibly-changed) source.
        if (rebalanceCommitted) {
          const oldLoc = preEdit.from_location_id;
          const newLoc = (data.from_location_id != null) ? data.from_location_id : preEdit.from_location_id;
          for (const oi of oldCommitItems) {
            if (!oi.variant_id) continue;
            await conn.execute(
              `UPDATE ims_stock SET qty_committed = GREATEST(0, qty_committed - ?)
               WHERE variant_id = ? AND location_id = ?`,
              [oi.qty_sent, oi.variant_id, oldLoc]
            );
          }
          for (const item of items) {
            if (!item.variant_id) continue;
            await conn.execute(
              `INSERT INTO ims_stock (variant_id, location_id, qty_committed)
               VALUES (?, ?, ?)
               ON DUPLICATE KEY UPDATE qty_committed = qty_committed + VALUES(qty_committed)`,
              [item.variant_id, newLoc, item.qty_sent]
            );
          }
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
      let finalStatus: BTStatus = newStatus;
      if (from === finalStatus) { await conn.commit(); return; }

      // Allowed transitions
      const allowed: Record<string, string[]> = {
        draft:   ['sent', 'cancelled'],
        sent:    ['received', 'cancelled'],
        partial: ['received', 'cancelled'],
      };
      if (!allowed[from]?.includes(finalStatus)) throw new Error(`Cannot transition from ${from} to ${finalStatus}`);

      // draft → sent: commit stock at source so it can't be oversold or re-sent.
      if (from === 'draft' && newStatus === 'sent') {
        for (const item of items) {
          const qtySent = Number(item.qty_sent);
          if (qtySent <= 0) continue;
          await conn.execute(
            `INSERT INTO ims_stock (variant_id, location_id, qty_committed)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE qty_committed = qty_committed + VALUES(qty_committed)`,
            [item.variant_id, bt.from_location_id, qtySent]
          );
        }
      }

      // sent → cancelled: release committed stock at source.
      if (newStatus === 'cancelled' && from === 'sent') {
        for (const item of items) {
          await conn.execute(
            `UPDATE ims_stock SET qty_committed = GREATEST(0, qty_committed - ?)
             WHERE variant_id = ? AND location_id = ?`,
            [Number(item.qty_sent), item.variant_id, bt.from_location_id]
          );
        }
      }

      // sent → received/partial: move stock, record ACTUAL line values
      // (qty_received × unit_cost), and auto-detect a shortfall.
      if (from === 'sent' && finalStatus === 'received') {
        let anyShortfall = false;
        for (const item of items) {
          const found = receivedItems?.find(r => r.item_id === item.id);
          const qty_rcvd = found != null
            ? Math.min(Math.max(0, Number(found.qty_received)), Number(item.qty_sent))
            : Number(item.qty_sent);
          if (qty_rcvd < Number(item.qty_sent)) anyShortfall = true;

          await conn.execute(
            `UPDATE ims_branch_transfer_items SET qty_received = ?, line_value = ? * unit_cost WHERE id = ?`,
            [qty_rcvd, qty_rcvd, item.id]
          );
          // Release the full commitment (qty_sent) — the shortfall never physically left.
          await conn.execute(
            `UPDATE ims_stock SET qty_committed = GREATEST(0, qty_committed - ?)
             WHERE variant_id = ? AND location_id = ?`,
            [Number(item.qty_sent), item.variant_id, bt.from_location_id]
          );
          await _btMove(conn, bt, id, item, qty_rcvd);
        }
        // Any item received short of qty_sent leaves the transfer 'partial'.
        if (anyShortfall) finalStatus = 'partial';
        await conn.execute(`UPDATE ims_branch_transfers SET received_date = CURDATE() WHERE id = ?`, [id]);
      }

      // partial → received: apply qty_received corrections as SIGNED deltas
      // (receive more, or reverse an over-receipt), refresh line values, close.
      if (from === 'partial' && finalStatus === 'received') {
        for (const item of items) {
          const found = receivedItems?.find(r => r.item_id === item.id);
          if (found == null) continue;
          const current  = Number(item.qty_received ?? 0);
          const finalQty = Math.min(Math.max(0, Number(found.qty_received)), Number(item.qty_sent));
          const delta    = finalQty - current;
          if (delta !== 0) await _btMove(conn, bt, id, item, delta);
          await conn.execute(
            `UPDATE ims_branch_transfer_items SET qty_received = ?, line_value = ? * unit_cost WHERE id = ?`,
            [finalQty, finalQty, item.id]
          );
        }
        await conn.execute(`UPDATE ims_branch_transfers SET received_date = CURDATE() WHERE id = ?`, [id]);
      }

      // Keep total_value in step with the (now actual) line values.
      if (finalStatus === 'received' || finalStatus === 'partial') {
        await conn.execute(
          `UPDATE ims_branch_transfers
             SET total_value = (SELECT COALESCE(SUM(line_value),0) FROM ims_branch_transfer_items WHERE transfer_id = ?)
           WHERE id = ?`,
          [id, id]
        );
      }

      await conn.execute(`UPDATE ims_branch_transfers SET status = ? WHERE id = ?`, [finalStatus, id]);
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
  },

  /**
   * Correct the qty_received on a transfer line (the actual quantity that
   * transferred). Moves the SIGNED delta of stock between branches — receiving
   * more sends additional units source → destination; lowering the figure
   * returns the difference destination → source. Clamped to 0..qty_sent.
   * Refreshes line_value (qty_received × unit_cost) and the transfer total.
   */
  async setItemReceived(transferId: number, itemId: number, newReceived: number): Promise<void> {
    const target = Number(newReceived);
    if (!Number.isFinite(target) || target < 0) throw new Error('Qty received must be zero or more');
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[bt]] = await conn.execute<any[]>(`SELECT * FROM ims_branch_transfers WHERE id = ?`, [transferId]);
      if (!bt) throw new Error('Branch transfer not found');
      const [[item]] = await conn.execute<any[]>(
        `SELECT * FROM ims_branch_transfer_items WHERE id = ? AND transfer_id = ?`,
        [itemId, transferId]
      );
      if (!item) throw new Error('Item not found on this transfer');
      const finalQty = Math.min(target, Number(item.qty_sent));
      const current  = Number(item.qty_received ?? 0);
      const delta    = finalQty - current;
      if (delta !== 0) await _btMove(conn, bt, transferId, item, delta);
      await conn.execute(
        `UPDATE ims_branch_transfer_items SET qty_received = ?, line_value = ? * unit_cost WHERE id = ?`,
        [finalQty, finalQty, itemId]
      );
      await conn.execute(
        `UPDATE ims_branch_transfers
           SET total_value = (SELECT COALESCE(SUM(line_value),0) FROM ims_branch_transfer_items WHERE transfer_id = ?)
         WHERE id = ?`,
        [transferId, transferId]
      );
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
  },

  /**
   * Remove a line from a transfer. If any stock was already received for it,
   * those movements are reversed (units returned to the source branch) before
   * the line is deleted. Recomputes the transfer total.
   */
  async removeItem(transferId: number, itemId: number): Promise<void> {
    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[bt]] = await conn.execute<any[]>(`SELECT * FROM ims_branch_transfers WHERE id = ?`, [transferId]);
      if (!bt) throw new Error('Branch transfer not found');
      const [[item]] = await conn.execute<any[]>(
        `SELECT * FROM ims_branch_transfer_items WHERE id = ? AND transfer_id = ?`,
        [itemId, transferId]
      );
      if (!item) throw new Error('Item not found on this transfer');
      const rcvd = Number(item.qty_received ?? 0);
      // If BT is still 'sent', release the committed stock at source for this item.
      if (bt.status === 'sent') {
        const qtySent = Number(item.qty_sent);
        if (qtySent > 0) {
          await conn.execute(
            `UPDATE ims_stock SET qty_committed = GREATEST(0, qty_committed - ?)
             WHERE variant_id = ? AND location_id = ?`,
            [qtySent, item.variant_id, bt.from_location_id]
          );
        }
      }
      // Return any already-received units to the source branch.
      if (rcvd > 0) await _btMove(conn, bt, transferId, item, -rcvd);
      await conn.execute(`DELETE FROM ims_branch_transfer_items WHERE id = ?`, [itemId]);
      await conn.execute(
        `UPDATE ims_branch_transfers
           SET total_value = (SELECT COALESCE(SUM(line_value),0) FROM ims_branch_transfer_items WHERE transfer_id = ?)
         WHERE id = ?`,
        [transferId, transferId]
      );
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
    if ((rows[0]?.cnt ?? 0) >= 8) throw new Error('Maximum of 8 media items per product.');

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
    businessId: string,
    detail?: object,
  ): Promise<void> {
    await imsExecute(
      `INSERT INTO ims_shopify_sync_log (business_id, action, status, summary, detail) VALUES (?, ?, ?, ?, ?)`,
      [businessId, action, status, summary, detail ? JSON.stringify(detail) : null],
    );
  },

  async getLog(limit = 50, businessId?: string): Promise<ImsShopifySyncLog[]> {
    if (businessId) {
      return imsQuery<ImsShopifySyncLog>(
        `SELECT * FROM ims_shopify_sync_log WHERE business_id = ? ORDER BY created_at DESC LIMIT ?`,
        [businessId, limit],
      );
    }
    return imsQuery<ImsShopifySyncLog>(
      `SELECT * FROM ims_shopify_sync_log ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
  },

  // ── Status counts ─────────────────────────────────────────────────────────
  async getCounts(businessId: string): Promise<{ linked: number; notInShopify: number; total: number }> {
    const rows = await imsQuery<{ linked: number; total: number }>(
      `SELECT
         COUNT(*) AS total,
         SUM(shopify_product_id IS NOT NULL) AS linked
       FROM ims_products WHERE is_active = 1 AND business_id = ?`,
      [businessId],
    );
    const { total = 0, linked = 0 } = rows[0] ?? {};
    return { linked: Number(linked), notInShopify: Number(total) - Number(linked), total: Number(total) };
  },

  // ── Link IDs after reconcile / upload ────────────────────────────────────
  async linkProduct(productId: string, shopifyProductId: string, businessId: string): Promise<void> {
    await imsExecute(
      `UPDATE ims_products SET shopify_product_id = ? WHERE product_id = ? AND business_id = ?`,
      [shopifyProductId, productId, businessId],
    );
  },

  async linkVariant(
    variantId: string,
    shopifyVariantId: string,
    shopifyInventoryItemId: string,
    businessId: string,
  ): Promise<void> {
    await imsExecute(
      `UPDATE ims_product_variants
         SET shopify_variant_id = ?, shopify_inventory_item_id = ?
       WHERE variant_id = ? AND business_id = ?`,
      [shopifyVariantId, shopifyInventoryItemId, variantId, businessId],
    );
  },

  // ── Products list with link status ───────────────────────────────────────
  async listWithShopifyStatus(businessId: string): Promise<Array<ImsProduct & { shopify_status: 'linked' | 'not_in_shopify' }>> {
    const products = await imsQuery<any>(
      `SELECT p.*,
         IF(p.shopify_product_id IS NOT NULL, 'linked', 'not_in_shopify') AS shopify_status
       FROM ims_products p
       WHERE p.is_active = 1 AND p.business_id = ?
       ORDER BY p.name`,
      [businessId],
    );
    const variants = await imsQuery<ImsVariant>(
      `SELECT * FROM ims_product_variants WHERE is_active = 1 AND business_id = ? ORDER BY sku`,
      [businessId],
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

// ─────────────────────────────────────────────────────────────────────────────
// Credit Notes
// ─────────────────────────────────────────────────────────────────────────────

export type CNStatus = 'draft' | 'awaiting_product' | 'complete';

export interface ImsCN {
  id: number;
  business_id: string;
  cn_number: string;
  customer_id?: number | null;
  so_id?: number | null;
  original_so_number?: string | null;
  location_id: number;
  status: CNStatus;
  source?: 'manual' | 'shopify';
  shopify_refund_id?: string | null;
  shopify_return_id?: string | null;   // Shopify Returns API id (links return approval to refund)
  cn_date: string;
  completed_at?: string | null;
  reference?: string | null;
  tax_treatment: 'ex_tax' | 'inc_tax';
  tax_code?: string | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  notes?: string | null;
  xero_credit_note_id?: string | null;
  xero_synced_at?: string | null;
  xero_sync_status?: 'synced' | 'queued' | 'error' | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  // joined
  customer_name?: string | null;
  location_name?: string | null;
  items?: ImsCNItem[];
}

export interface ImsCNItem {
  id: number;
  cn_id: number;
  variant_id?: string | null;
  code?: string | null;
  name?: string | null;
  qty: number;
  unit_price: number;
  price_basis: 'cost' | 'wholesale' | 'rrp' | 'custom';
  restock?: boolean | number;
  tax_rate: number;
  line_total: number;
  // joined from variant / product
  sku?: string | null;
  product_name?: string | null;
  variant_label?: string | null;
  avg_cost?: number | null;
}

async function nextCNNumber(businessId: string): Promise<string> {
  const rows = await imsQuery<{ max_num: string | null }>(
    `SELECT MAX(CAST(REGEXP_REPLACE(cn_number, '[^0-9]', '') AS UNSIGNED)) AS max_num
     FROM ims_credit_notes WHERE business_id = ?`,
    [businessId],
  );
  const next = (Number(rows[0]?.max_num ?? 0) + 1).toString().padStart(5, '0');
  return `CN-${next}`;
}

/**
 * Restock the returnable lines of a credit note within an open transaction.
 * Only items flagged restock=1 (and with a variant) put stock back; broken /
 * not-returned lines are credit-only. Writes a 'cn_returned' stock movement
 * referencing the credit note.
 */
async function restockCreditNoteItemsTx(
  conn: any,
  cnId: number,
  locationId: number,
  items: ImsCNItem[],
  channel: string | null,
): Promise<void> {
  for (const item of items) {
    if (!item.variant_id) continue;
    const doRestock = item.restock === undefined || item.restock === null ? true : !!Number(item.restock);
    if (!doRestock) continue;
    const qty = Number(item.qty);
    if (!(qty > 0)) continue;
    await conn.execute(
      `INSERT IGNORE INTO ims_stock (variant_id, location_id) VALUES (?, ?)`,
      [item.variant_id, locationId],
    );
    await conn.execute(
      `UPDATE ims_stock SET qty_on_hand = qty_on_hand + ? WHERE variant_id = ? AND location_id = ?`,
      [qty, item.variant_id, locationId],
    );
    const [rows] = await conn.execute(
      `SELECT qty_on_hand FROM ims_stock WHERE variant_id = ? AND location_id = ?`,
      [item.variant_id, locationId],
    );
    const s = (rows as any[])[0];
    await conn.execute(
      `INSERT INTO ims_stock_movements
         (variant_id,location_id,movement_type,channel,reference_type,reference_id,qty_change,qty_after_soh)
       VALUES (?,?,'cn_returned',?,'credit_note',?,?,?)`,
      [item.variant_id, locationId, channel, cnId, qty, s?.qty_on_hand ?? 0],
    );
  }
}

export const ImsCNRepo = {
  async list(businessId: string, status?: CNStatus): Promise<ImsCN[]> {
    const wheres: string[] = ['cn.business_id = ?'];
    const params: any[] = [businessId];
    if (status) { wheres.push('cn.status = ?'); params.push(status); }
    return imsQuery<ImsCN>(
      `SELECT cn.*,
              c.name AS customer_name,
              l.name AS location_name
       FROM ims_credit_notes cn
       LEFT JOIN ims_contacts c ON c.id = cn.customer_id
       JOIN ims_locations l ON l.id = cn.location_id
       WHERE ${wheres.join(' AND ')}
       ORDER BY cn.created_at DESC`,
      params,
    );
  },

  async get(id: number, businessId: string): Promise<ImsCN | null> {
    const rows = await imsQuery<ImsCN>(
      `SELECT cn.*,
              c.name  AS customer_name,
              c.email AS customer_email,
              l.name  AS location_name
       FROM ims_credit_notes cn
       LEFT JOIN ims_contacts c ON c.id = cn.customer_id
       JOIN ims_locations l ON l.id = cn.location_id
       WHERE cn.id = ? AND cn.business_id = ?`,
      [id, businessId],
    );
    if (!rows[0]) return null;
    await ensureVariantAvgCost();
    const items = await imsQuery<ImsCNItem>(
      `SELECT i.*,
              COALESCE(v.sku, i.code) AS sku,
              COALESCE(p.name, i.name) AS product_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''),
                NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')
              ) AS variant_label,
              COALESCE(v.avg_cost, v.cost_aud) AS avg_cost
       FROM ims_credit_note_items i
       LEFT JOIN ims_product_variants v ON v.variant_id = i.variant_id
       LEFT JOIN ims_products p ON p.product_id = v.product_id
       WHERE i.cn_id = ?`,
      [id],
    );
    return { ...rows[0], items };
  },

  async create(
    data: Pick<ImsCN, 'location_id' | 'cn_date' | 'reference' | 'tax_treatment' | 'tax_code' | 'notes' | 'customer_id'> &
      Partial<Pick<ImsCN, 'so_id' | 'original_so_number' | 'source' | 'shopify_refund_id'>>,
    items: (Omit<ImsCNItem, 'id' | 'cn_id' | 'line_total' | 'sku' | 'product_name' | 'variant_label' | 'avg_cost'>)[],
    businessId: string,
    createdBy?: string,
  ): Promise<number> {
    const cn_number = await nextCNNumber(businessId);
    let subtotal = 0, tax_amount = 0;
    for (const item of items) {
      const line = Number(item.qty) * Number(item.unit_price);
      subtotal   += line;
      tax_amount += line * Number(item.tax_rate ?? 0);
    }
    const res = await imsExecute(
      `INSERT INTO ims_credit_notes
         (business_id,cn_number,customer_id,so_id,original_so_number,location_id,status,source,shopify_refund_id,cn_date,reference,
          tax_treatment,tax_code,subtotal,tax_amount,total_amount,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [businessId, cn_number, data.customer_id ?? null, data.so_id ?? null, data.original_so_number ?? null,
       data.location_id, 'draft', data.source ?? 'manual', data.shopify_refund_id ?? null,
       data.cn_date, data.reference ?? null, data.tax_treatment, data.tax_code ?? null,
       subtotal, tax_amount, subtotal + tax_amount,
       data.notes ?? null, createdBy ?? null],
    );
    const cn_id = (res as any).insertId;
    for (const item of items) {
      const line_total = Number(item.qty) * Number(item.unit_price);
      await imsExecute(
        `INSERT INTO ims_credit_note_items
           (cn_id,variant_id,code,name,qty,unit_price,price_basis,restock,tax_rate,line_total)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [cn_id, item.variant_id ?? null, item.code ?? null, item.name ?? null,
         item.qty, item.unit_price, item.price_basis ?? 'custom',
         item.restock === undefined ? 1 : (item.restock ? 1 : 0),
         item.tax_rate ?? 0, line_total],
      );
    }
    return cn_id;
  },

  async update(
    id: number,
    businessId: string,
    data: Partial<Pick<ImsCN, 'location_id' | 'cn_date' | 'customer_id' | 'so_id' | 'original_so_number' | 'reference' | 'tax_treatment' | 'tax_code' | 'notes'>>,
    items?: (Omit<ImsCNItem, 'id' | 'cn_id' | 'line_total' | 'sku' | 'product_name' | 'variant_label' | 'avg_cost'>)[],
  ): Promise<void> {
    const allowed = ['location_id','cn_date','customer_id','so_id','original_so_number','reference','tax_treatment','tax_code','notes'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const f of allowed) {
      if (data[f as keyof typeof data] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(data[f as keyof typeof data] ?? null);
      }
    }
    if (items !== undefined) {
      // Recompute totals
      let subtotal = 0, tax_amount = 0;
      for (const item of items) {
        const line = Number(item.qty) * Number(item.unit_price);
        subtotal   += line;
        tax_amount += line * Number(item.tax_rate ?? 0);
      }
      sets.push('subtotal = ?', 'tax_amount = ?', 'total_amount = ?');
      vals.push(subtotal, tax_amount, subtotal + tax_amount);
    }
    if (sets.length) {
      vals.push(id, businessId);
      await imsExecute(
        `UPDATE ims_credit_notes SET ${sets.join(', ')} WHERE id = ? AND business_id = ? AND status = 'draft'`,
        vals,
      );
    }
    if (items !== undefined) {
      await imsExecute(`DELETE FROM ims_credit_note_items WHERE cn_id = ?`, [id]);
      for (const item of items) {
        const line_total = Number(item.qty) * Number(item.unit_price);
        await imsExecute(
          `INSERT INTO ims_credit_note_items
             (cn_id,variant_id,code,name,qty,unit_price,price_basis,restock,tax_rate,line_total)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [id, item.variant_id ?? null, item.code ?? null, item.name ?? null,
           item.qty, item.unit_price, item.price_basis ?? 'custom',
           item.restock === undefined ? 1 : (item.restock ? 1 : 0),
           item.tax_rate ?? 0, line_total],
        );
      }
    }
  },

  /** draft → awaiting_product (goods not yet received; refund pending). */
  async setAwaiting(id: number, businessId: string): Promise<void> {
    await imsExecute(
      `UPDATE ims_credit_notes SET status = 'awaiting_product'
        WHERE id = ? AND business_id = ? AND status = 'draft'`,
      [id, businessId],
    );
  },

  /** Complete a draft/awaiting CN: return stock for restock lines, insert movements, mark complete. Atomic. */
  async complete(id: number, businessId: string): Promise<void> {
    const cn = await ImsCNRepo.get(id, businessId);
    if (!cn) throw new Error('Credit note not found');
    if (cn.status === 'complete') throw new Error('Credit note is already complete');
    if (cn.status !== 'draft' && cn.status !== 'awaiting_product') throw new Error('Only draft or awaiting credit notes can be completed');

    // Determine the return channel from the linked SO (for stock movement reporting).
    let channel: string | null = null;
    if (cn.so_id) {
      const soRows = await imsQuery<{ so_type: string }>(
        `SELECT so_type FROM ims_sales_orders WHERE id = ? AND business_id = ?`,
        [cn.so_id, businessId],
      );
      channel = soRows[0]?.so_type === 'online' ? 'online' : soRows[0] ? 'wholesale' : null;
    }

    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await restockCreditNoteItemsTx(conn, cn.id, cn.location_id, cn.items ?? [], channel);
      await conn.execute(
        `UPDATE ims_credit_notes SET status = 'complete', completed_at = NOW() WHERE id = ?`,
        [id],
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async delete(id: number, businessId: string): Promise<void> {
    await imsExecute(
      `DELETE FROM ims_credit_notes WHERE id = ? AND business_id = ? AND status = 'draft'`,
      [id, businessId],
    );
  },

  /**
   * Create an awaiting_product credit note when Shopify approves a return
   * (returns/approve webhook). The return has been agreed but goods aren't
   * back yet — no stock movement, no Xero. When the matching refund arrives
   * via refunds/create, processShopifyRefund updates and completes this CN.
   *
   * Idempotent on (business_id, shopify_return_id).
   */
  async createFromShopifyReturn(
    businessId: string,
    opts: {
      soId: number;
      shopifyReturnId: string;
      lineItems: {
        shopifyVariantId: string;
        shopifyLineItemId?: number | string | null;
        quantity: number;
        unitPrice: number;
        name?: string | null;
        sku?: string | null;
      }[];
    },
  ): Promise<{ created: boolean; cnId: number | null }> {
    // Idempotency check.
    const existing = await imsQuery<{ id: number }>(
      `SELECT id FROM ims_credit_notes WHERE business_id = ? AND shopify_return_id = ? LIMIT 1`,
      [businessId, String(opts.shopifyReturnId)],
    );
    if (existing[0]) return { created: false, cnId: existing[0].id };

    const [soRows] = await Promise.all([
      imsQuery<{ id: number; location_id: number; so_type: string; so_number: string; customer_id: number | null; tax_rate: number }>(
        `SELECT so.id, so.location_id, so.so_type, so.so_number, so.customer_id,
                COALESCE(AVG(i.tax_rate), 0.1) AS tax_rate
           FROM ims_sales_orders so
           LEFT JOIN ims_sales_order_items i ON i.so_id = so.id
          WHERE so.id = ? AND so.business_id = ? LIMIT 1`,
        [opts.soId, businessId],
      ),
    ]);
    const so = soRows[0];
    if (!so) return { created: false, cnId: null };

    const variantRows = await imsQuery<{ variant_id: string; shopify_variant_id: string; sku: string | null }>(
      `SELECT v.variant_id, v.shopify_variant_id, v.sku
         FROM ims_product_variants v JOIN ims_products p ON p.product_id = v.product_id
        WHERE p.business_id = ?`,
      [businessId],
    );
    const variantMap = new Map(variantRows.map(r => [String(r.shopify_variant_id), r]));

    const cnItemsData: Omit<ImsCNItem, 'id' | 'cn_id' | 'line_total' | 'sku' | 'product_name' | 'variant_label' | 'avg_cost'>[] = [];
    for (const li of opts.lineItems) {
      const qty = Number(li.quantity);
      if (!(qty > 0)) continue;
      const v = variantMap.get(String(li.shopifyVariantId));
      const variantId = v?.variant_id ?? null;
      cnItemsData.push({
        variant_id: variantId,
        code: li.sku ?? v?.sku ?? null,
        name: li.name ?? null,
        qty,
        unit_price: Math.round(Number(li.unitPrice ?? 0) * 10000) / 10000,
        price_basis: 'custom',
        restock: 1,
        tax_rate: Number(so.tax_rate ?? 0.1),
      });
    }

    let subtotal = 0, taxAmount = 0;
    for (const it of cnItemsData) {
      const base = it.qty * it.unit_price;
      subtotal += base;
      taxAmount += base * Number(it.tax_rate);
    }
    subtotal  = Math.round(subtotal * 100) / 100;
    taxAmount = Math.round(taxAmount * 100) / 100;

    const cn_number = await nextCNNumber(businessId);
    const cnDate = new Date().toISOString().slice(0, 10);

    const res = await imsExecute(
      `INSERT IGNORE INTO ims_credit_notes
         (business_id, cn_number, customer_id, so_id, original_so_number, location_id,
          status, source, shopify_return_id, cn_date, reference,
          tax_treatment, subtotal, tax_amount, total_amount)
       VALUES (?,?,?,?,?,?, 'awaiting_product','shopify',?, ?, ?, 'inc_tax',?,?,?)`,
      [businessId, cn_number, so.customer_id ?? null, so.id, so.so_number ?? null, so.location_id,
       String(opts.shopifyReturnId), cnDate,
       `Shopify return ${opts.shopifyReturnId} (awaiting goods)`,
       subtotal, taxAmount, subtotal + taxAmount],
    );
    if (!(res as any).affectedRows) return { created: false, cnId: null };
    const cnId = (res as any).insertId;

    for (const it of cnItemsData) {
      const lt = Math.round(it.qty * it.unit_price * 100) / 100;
      await imsExecute(
        `INSERT INTO ims_credit_note_items (cn_id,variant_id,code,name,qty,unit_price,price_basis,restock,tax_rate,line_total)
         VALUES (?,?,?,?,?,?,'custom',?,?,?)`,
        [cnId, it.variant_id, it.code, it.name, it.qty, it.unit_price, it.restock ? 1 : 0, it.tax_rate, lt],
      );
    }
    return { created: true, cnId };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Supplier Credit Notes (credits RECEIVED FROM suppliers → Xero ACCPAY)
// ─────────────────────────────────────────────────────────────────────────────

export type SupplierCNStatus = 'draft' | 'complete' | 'cancelled';

export interface ImsSupplierCN {
  id: number;
  business_id: string;
  scn_number: string;
  supplier_id?: number | null;
  po_id?: number | null;
  location_id: number;
  status: SupplierCNStatus;
  scn_date: string;
  completed_at?: string | null;
  reference?: string | null;
  supplier_credit_ref?: string | null;
  currency_code?: string;
  exchange_rate?: number;
  tax_treatment: 'ex_tax' | 'inc_tax' | 'no_tax';
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  notes?: string | null;
  xero_credit_note_id?: string | null;
  xero_synced_at?: string | null;
  xero_sync_status?: 'synced' | 'queued' | 'error' | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  // joined
  supplier_name?: string | null;
  location_name?: string | null;
  po_number?: string | null;
  items?: ImsSupplierCNItem[];
}

export interface ImsSupplierCNItem {
  id: number;
  scn_id: number;
  variant_id?: string | null;
  code?: string | null;
  name?: string | null;
  qty: number;
  unit_cost: number;
  restock?: boolean | number;
  tax_rate: number;
  line_total: number;
  // joined
  sku?: string | null;
  product_name?: string | null;
  variant_label?: string | null;
}

async function nextSCNNumber(businessId: string): Promise<string> {
  const rows = await imsQuery<{ max_num: string | null }>(
    `SELECT MAX(CAST(REGEXP_REPLACE(scn_number, '[^0-9]', '') AS UNSIGNED)) AS max_num
     FROM ims_supplier_credit_notes WHERE business_id = ?`,
    [businessId],
  );
  const next = (Number(rows[0]?.max_num ?? 0) + 1).toString().padStart(5, '0');
  return `SCN-${next}`;
}

/**
 * Reduce stock for the restockable lines of a supplier credit note (goods
 * physically returned to the supplier) within an open transaction. Non-restock
 * lines (rebates / overcharges) are money-only. Writes a 'scn_returned' stock
 * movement. Removing units at the current avg cost does not change avg cost.
 */
async function returnStockToSupplierTx(
  conn: any,
  scnId: number,
  locationId: number,
  items: ImsSupplierCNItem[],
): Promise<void> {
  for (const item of items) {
    if (!item.variant_id) continue;
    const doRestock = item.restock === undefined || item.restock === null ? true : !!Number(item.restock);
    if (!doRestock) continue;
    const qty = Number(item.qty);
    if (!(qty > 0)) continue;
    await conn.execute(
      `INSERT IGNORE INTO ims_stock (variant_id, location_id) VALUES (?, ?)`,
      [item.variant_id, locationId],
    );
    const [rows] = await conn.execute(
      `SELECT qty_on_hand, avg_cost FROM ims_stock WHERE variant_id = ? AND location_id = ?`,
      [item.variant_id, locationId],
    );
    const s = (rows as any[])[0];
    const newSoh = Number(s?.qty_on_hand ?? 0) - qty; // goods leave
    const unitCost = Number(s?.avg_cost ?? item.unit_cost ?? 0);
    await conn.execute(
      `UPDATE ims_stock SET qty_on_hand = ? WHERE variant_id = ? AND location_id = ?`,
      [newSoh, item.variant_id, locationId],
    );
    await refreshVariantAvgCost(conn, item.variant_id);
    await conn.execute(
      `INSERT INTO ims_stock_movements
         (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
       VALUES (?,?,'scn_returned','supplier_credit_note',?,?,?,?)`,
      [item.variant_id, locationId, scnId, -qty, newSoh, unitCost],
    );
  }
}

export const ImsSupplierCNRepo = {
  async list(businessId: string, status?: SupplierCNStatus): Promise<ImsSupplierCN[]> {
    const wheres: string[] = ['scn.business_id = ?'];
    const params: any[] = [businessId];
    if (status) { wheres.push('scn.status = ?'); params.push(status); }
    return imsQuery<ImsSupplierCN>(
      `SELECT scn.*,
              c.name  AS supplier_name,
              l.name  AS location_name,
              po.po_number AS po_number
       FROM ims_supplier_credit_notes scn
       LEFT JOIN ims_contacts c ON c.id = scn.supplier_id
       JOIN ims_locations l ON l.id = scn.location_id
       LEFT JOIN ims_purchase_orders po ON po.id = scn.po_id
       WHERE ${wheres.join(' AND ')}
       ORDER BY scn.created_at DESC`,
      params,
    );
  },

  async get(id: number, businessId: string): Promise<ImsSupplierCN | null> {
    const rows = await imsQuery<ImsSupplierCN>(
      `SELECT scn.*,
              c.name  AS supplier_name,
              c.email AS supplier_email,
              l.name  AS location_name,
              po.po_number AS po_number
       FROM ims_supplier_credit_notes scn
       LEFT JOIN ims_contacts c ON c.id = scn.supplier_id
       JOIN ims_locations l ON l.id = scn.location_id
       LEFT JOIN ims_purchase_orders po ON po.id = scn.po_id
       WHERE scn.id = ? AND scn.business_id = ?`,
      [id, businessId],
    );
    if (!rows[0]) return null;
    await ensureVariantAvgCost();
    const items = await imsQuery<ImsSupplierCNItem>(
      `SELECT i.*,
              COALESCE(v.sku, i.code) AS sku,
              COALESCE(p.name, i.name) AS product_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''),
                NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')
              ) AS variant_label
       FROM ims_supplier_credit_note_items i
       LEFT JOIN ims_product_variants v ON v.variant_id = i.variant_id
       LEFT JOIN ims_products p ON p.product_id = v.product_id
       WHERE i.scn_id = ?`,
      [id],
    );
    return { ...rows[0], items };
  },

  async create(
    data: Pick<ImsSupplierCN, 'location_id' | 'scn_date' | 'tax_treatment'> &
      Partial<Pick<ImsSupplierCN, 'supplier_id' | 'po_id' | 'reference' | 'supplier_credit_ref' | 'currency_code' | 'exchange_rate' | 'notes'>>,
    items: Omit<ImsSupplierCNItem, 'id' | 'scn_id' | 'line_total' | 'sku' | 'product_name' | 'variant_label'>[],
    businessId: string,
    createdBy?: string,
  ): Promise<number> {
    const scn_number = await nextSCNNumber(businessId);
    let subtotal = 0, tax_amount = 0;
    for (const item of items) {
      const line = Number(item.qty) * Number(item.unit_cost);
      subtotal   += line;
      tax_amount += line * Number(item.tax_rate ?? 0);
    }
    const res = await imsExecute(
      `INSERT INTO ims_supplier_credit_notes
         (business_id,scn_number,supplier_id,po_id,location_id,status,scn_date,reference,supplier_credit_ref,
          currency_code,exchange_rate,tax_treatment,subtotal,tax_amount,total_amount,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [businessId, scn_number, data.supplier_id ?? null, data.po_id ?? null, data.location_id, 'draft',
       data.scn_date, data.reference ?? null, data.supplier_credit_ref ?? null,
       data.currency_code ?? 'AUD', data.exchange_rate ?? 1, data.tax_treatment,
       subtotal, tax_amount, subtotal + tax_amount, data.notes ?? null, createdBy ?? null],
    );
    const scn_id = (res as any).insertId;
    for (const item of items) {
      const line_total = Number(item.qty) * Number(item.unit_cost);
      await imsExecute(
        `INSERT INTO ims_supplier_credit_note_items
           (scn_id,variant_id,code,name,qty,unit_cost,restock,tax_rate,line_total)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [scn_id, item.variant_id ?? null, item.code ?? null, item.name ?? null,
         item.qty, item.unit_cost,
         item.restock === undefined ? 1 : (item.restock ? 1 : 0),
         item.tax_rate ?? 0, line_total],
      );
    }
    return scn_id;
  },

  async update(
    id: number,
    businessId: string,
    data: Partial<Pick<ImsSupplierCN, 'location_id' | 'scn_date' | 'supplier_id' | 'po_id' | 'reference' | 'supplier_credit_ref' | 'currency_code' | 'exchange_rate' | 'tax_treatment' | 'notes'>>,
    items?: Omit<ImsSupplierCNItem, 'id' | 'scn_id' | 'line_total' | 'sku' | 'product_name' | 'variant_label'>[],
  ): Promise<void> {
    const allowed = ['location_id','scn_date','supplier_id','po_id','reference','supplier_credit_ref','currency_code','exchange_rate','tax_treatment','notes'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const f of allowed) {
      if (data[f as keyof typeof data] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(data[f as keyof typeof data] ?? null);
      }
    }
    if (items !== undefined) {
      let subtotal = 0, tax_amount = 0;
      for (const item of items) {
        const line = Number(item.qty) * Number(item.unit_cost);
        subtotal   += line;
        tax_amount += line * Number(item.tax_rate ?? 0);
      }
      sets.push('subtotal = ?', 'tax_amount = ?', 'total_amount = ?');
      vals.push(subtotal, tax_amount, subtotal + tax_amount);
    }
    if (sets.length) {
      vals.push(id, businessId);
      await imsExecute(
        `UPDATE ims_supplier_credit_notes SET ${sets.join(', ')} WHERE id = ? AND business_id = ? AND status = 'draft'`,
        vals,
      );
    }
    if (items !== undefined) {
      await imsExecute(`DELETE FROM ims_supplier_credit_note_items WHERE scn_id = ?`, [id]);
      for (const item of items) {
        const line_total = Number(item.qty) * Number(item.unit_cost);
        await imsExecute(
          `INSERT INTO ims_supplier_credit_note_items
             (scn_id,variant_id,code,name,qty,unit_cost,restock,tax_rate,line_total)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [id, item.variant_id ?? null, item.code ?? null, item.name ?? null,
           item.qty, item.unit_cost,
           item.restock === undefined ? 1 : (item.restock ? 1 : 0),
           item.tax_rate ?? 0, line_total],
        );
      }
    }
  },

  /** Complete a draft SCN: reduce stock for restock lines, mark complete. Atomic. */
  async complete(id: number, businessId: string): Promise<void> {
    const scn = await ImsSupplierCNRepo.get(id, businessId);
    if (!scn) throw new Error('Supplier credit note not found');
    if (scn.status === 'complete') throw new Error('Supplier credit note is already complete');
    if (scn.status !== 'draft') throw new Error('Only draft supplier credit notes can be completed');

    const pool = getIMSPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await returnStockToSupplierTx(conn, scn.id, scn.location_id, scn.items ?? []);
      await conn.execute(
        `UPDATE ims_supplier_credit_notes SET status = 'complete', completed_at = NOW() WHERE id = ?`,
        [id],
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async cancel(id: number, businessId: string): Promise<void> {
    await imsExecute(
      `UPDATE ims_supplier_credit_notes SET status = 'cancelled' WHERE id = ? AND business_id = ? AND status = 'draft'`,
      [id, businessId],
    );
  },

  async delete(id: number, businessId: string): Promise<void> {
    await imsExecute(
      `DELETE FROM ims_supplier_credit_notes WHERE id = ? AND business_id = ? AND status = 'draft'`,
      [id, businessId],
    );
  },
};
