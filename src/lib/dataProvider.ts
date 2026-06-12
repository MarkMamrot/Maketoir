import { imsQuery } from '@/services/IMSMySQLService';
import { ProductsRepository, StockRepository } from '@/lib/db/ProductsRepository';
import type { StockRow } from '@/lib/db/ProductsRepository';
import { BranchesRepository, SuppliersRepository } from '@/lib/db/BranchesAndSuppliersRepository';
import { ConfigRepository } from '@/lib/db/ConfigRepository';
import { SalesRepository } from '@/lib/db/SalesRepository';
import type { ImsProduct, ImsVariant, ImsStock, ImsSO, ImsSOItem, ImsContact, ImsLocation } from '@/lib/ims/ImsRepository';
import { cin7ProductToVariant, cin7SaleToLine } from '@/lib/adapters/cin7Adapter';
import { imsVariantToStandard, imsSOItemToSaleLine, imsPOSSaleToLine, type ImsPosSaleItem } from '@/lib/adapters/imsAdapter';
import type { StandardizedVariant, StandardizedVariantWithSales, StandardizedLocation, StandardizedContact, StandardizedSaleLine, VariantBranchStock } from '@/types/StandardizedData';

// ─── resolve which source to use ─────────────────────────────────────────────

async function resolveSource(businessId: string, source?: string): Promise<string> {
  if (source) return source;
  return (await ConfigRepository.get(businessId, 'inventory_source').catch(() => null)) ?? 'cin7';
}

// ─── products ─────────────────────────────────────────────────────────────────

export async function getProducts(
  businessId: string,
  source?: string,
): Promise<StandardizedVariant[]> {
  const src = await resolveSource(businessId, source);

  if (src === 'solvantis') {
    const products = await imsQuery<ImsProduct>('SELECT * FROM ims_products WHERE is_active = 1 ORDER BY name');
    const variants = await imsQuery<ImsVariant>('SELECT * FROM ims_product_variants WHERE is_active = 1');
    const stocks   = await imsQuery<ImsStock>('SELECT * FROM ims_stock');

    const productMap = new Map(products.map(p => [p.product_id, p]));
    // Sum stock across all locations per variant
    const stockByVariant = new Map<string, ImsStock>();
    for (const s of stocks) {
      const existing = stockByVariant.get(s.variant_id);
      if (!existing) {
        stockByVariant.set(s.variant_id, { ...s });
      } else {
        existing.qty_on_hand  += s.qty_on_hand;
        existing.qty_incoming += s.qty_incoming;
      }
    }

    const result: StandardizedVariant[] = [];
    for (const v of variants) {
      const p = productMap.get(v.product_id);
      if (!p) continue;
      result.push(imsVariantToStandard(p, v, stockByVariant.get(v.variant_id)));
    }
    return result;
  }

  // Default: cin7 (cached main DB)
  const rows = await ProductsRepository.list(businessId);
  return rows.map(cin7ProductToVariant);
}

// ─── sales ────────────────────────────────────────────────────────────────────

export async function getSales(
  businessId: string,
  source?: string,
  opts: { from?: string; to?: string } = {},
): Promise<StandardizedSaleLine[]> {
  const src = await resolveSource(businessId, source);

  if (src === 'solvantis') {
    const soConditions: string[] = [];
    const soParams: any[] = [];
    if (opts.from) { soConditions.push('so.order_date >= ?'); soParams.push(opts.from); }
    if (opts.to)   { soConditions.push('so.order_date <= ?'); soParams.push(opts.to); }
    const soWhere = soConditions.length ? 'WHERE ' + soConditions.join(' AND ') : '';

    const posConditions: string[] = ["ps.status = 'completed'", "ps.sale_type = 'sale'"];
    const posParams: any[] = [];
    if (opts.from) { posConditions.push('DATE(ps.completed_at) >= ?'); posParams.push(opts.from); }
    if (opts.to)   { posConditions.push('DATE(ps.completed_at) <= ?'); posParams.push(opts.to); }
    const posWhere = 'WHERE ' + posConditions.join(' AND ');

    const [orders, items, posItems] = await Promise.all([
      imsQuery<ImsSO>(
        `SELECT so.*, l.name AS location_name
         FROM ims_sales_orders so
         LEFT JOIN ims_locations l ON l.id = so.location_id
         ${soWhere} ORDER BY so.order_date DESC`,
        soParams,
      ),
      imsQuery<ImsSOItem & { sku: string; product_name: string }>(
        `SELECT i.*, v.sku, p.name AS product_name
         FROM ims_sales_order_items i
         JOIN ims_product_variants v ON v.variant_id = i.variant_id
         JOIN ims_products p ON p.product_id = v.product_id`,
      ),
      imsQuery<ImsPosSaleItem>(
        `SELECT psi.*, DATE(ps.completed_at) AS sale_date, l.name AS location_name,
                v.sku, p.name AS product_name
         FROM pos_sale_items psi
         JOIN pos_sales ps ON ps.id = psi.sale_id
         LEFT JOIN ims_locations l ON l.id = ps.location_id
         LEFT JOIN ims_product_variants v ON v.variant_id = psi.variant_id
         LEFT JOIN ims_products p ON p.product_id = v.product_id
         ${posWhere} ORDER BY ps.completed_at DESC`,
        posParams,
      ),
    ]);

    const soMap = new Map(orders.map(o => [o.id, o]));
    const soLines = items
      .filter(i => soMap.has(i.so_id))
      .map(i => imsSOItemToSaleLine(i, soMap.get(i.so_id)!));
    const posLines = posItems.map(imsPOSSaleToLine);
    return [...soLines, ...posLines];
  }

  // Default: cin7 (cached main DB)
  const rows = await SalesRepository.query(businessId, opts);
  return rows.map(cin7SaleToLine);
}

// ─── inventory source (public) ────────────────────────────────────────────────

export async function getInventorySource(businessId: string): Promise<string> {
  return resolveSource(businessId);
}

// ─── branches ─────────────────────────────────────────────────────────────────

export async function getBranches(
  businessId: string,
  source?: string,
): Promise<StandardizedLocation[]> {
  const src = await resolveSource(businessId, source);

  if (src === 'solvantis') {
    const rows = await imsQuery<ImsLocation>('SELECT * FROM ims_locations ORDER BY name');
    return rows.map(r => ({
      source_type: 'solvantis',
      source_id:   String(r.id),
      name:        r.name,
      code:        r.code ?? null,
      is_active:   r.is_active === 1,
    }));
  }

  const rows = await BranchesRepository.list(businessId);
  return rows.map(r => ({
    source_type: 'cin7',
    source_id:   r.cin7_id ?? r.name,
    name:        r.name,
    code:        null,
    is_active:   Boolean(r.is_active),
  }));
}

// ─── suppliers ────────────────────────────────────────────────────────────────

export async function getSuppliers(
  businessId: string,
  source?: string,
): Promise<StandardizedContact[]> {
  const src = await resolveSource(businessId, source);

  if (src === 'solvantis') {
    const rows = await imsQuery<ImsContact>(
      `SELECT * FROM ims_contacts WHERE type IN ('supplier', 'both') AND is_active = 1 ORDER BY name`,
    );
    return rows.map(r => ({
      source_type:    'solvantis',
      source_id:      String(r.id),
      name:           r.name,
      company:        r.company ?? null,
      email:          r.email ?? null,
      phone:          r.phone ?? null,
      type:           r.type,
      lead_time_days: r.lead_time_days ?? null,
      order_frequency_days: r.order_frequency_days ?? null,
    }));
  }

  const rows = await SuppliersRepository.list(businessId);
  return rows.map(r => ({
    source_type:    'cin7',
    source_id:      r.cin7_id ?? r.name,
    name:           r.name,
    company:        null,
    email:          r.email ?? null,
    phone:          r.phone ?? null,
    type:           'supplier' as const,
    lead_time_days: r.lead_time_days ?? null,
    order_frequency_days: null,
  }));
}

// ─── products with sales (pre-computed aggregates) ────────────────────────────

export async function getProductsWithSales(
  businessId: string,
  source?: string,
): Promise<StandardizedVariantWithSales[]> {
  const src = await resolveSource(businessId, source);

  if (src === 'solvantis') {
    type Row = {
      variant_id: string; sku: string | null; barcode: string | null;
      cost: number | null; price: number | null; pack_size: number | null;
      option1_value: string | null; option2_value: string | null; option3_value: string | null;
      product_name: string; brand: string | null; category: string | null;
      style_code: string | null; is_online: number | null; supplier_contact_id: number | null;
      product_id: string; created_at: string | null;
      sales_qty_7d: number; sales_qty_90d: number; sales_qty_180d: number; sales_qty_12m: number;
      global_soh: number; global_available: number; global_incoming: number;
    };

    const rows = await imsQuery<Row>(`
      SELECT
        v.variant_id, v.sku, v.barcode, v.cost, v.price, v.pack_size,
        v.option1_value, v.option2_value, v.option3_value,
        p.name AS product_name, p.brand,
        NULL AS category, NULL AS style_code,
        p.is_online, p.supplier_contact_id, p.product_id, p.created_at,
        COALESCE(c.sales_qty_7d,   0) AS sales_qty_7d,
        COALESCE(c.sales_qty_90d,  0) AS sales_qty_90d,
        COALESCE(c.sales_qty_180d, 0) AS sales_qty_180d,
        COALESCE(c.sales_qty_12m,  0) AS sales_qty_12m,
        COALESCE(c.global_soh,       0) AS global_soh,
        COALESCE(c.global_available, 0) AS global_available,
        COALESCE(c.global_incoming,  0) AS global_incoming
      FROM ims_product_variants v
      JOIN  ims_products    p ON p.product_id = v.product_id
      LEFT JOIN ims_sales_cache c ON c.variant_id = v.variant_id
      WHERE v.is_active = 1 AND p.is_active = 1
      ORDER BY p.name, v.sku
    `);

    return rows.map(r => {
      const optLabel = [r.option1_value, r.option2_value, r.option3_value]
        .filter(Boolean).join(' / ') || 'Default';
      return {
        source_type:      'solvantis',
        source_id:        r.variant_id,
        parent_source_id: String(r.product_id),
        sku:              r.sku ?? null,
        barcode:          r.barcode ?? null,
        name:             r.product_name,
        brand:            r.brand ?? null,
        category:         r.category ?? null,
        style_code:       r.style_code ?? null,
        option_label:     optLabel,
        cost:             r.cost != null ? Number(r.cost) : null,
        price:            r.price != null ? Number(r.price) : null,
        qty_on_hand:      Number(r.global_soh ?? 0),
        qty_incoming:     Number(r.global_incoming ?? 0),
        is_online:        r.is_online === 1,
        pack_size:        r.pack_size ?? null,
        created_date:     r.created_at ?? null,
        sales_qty_7d:     Number(r.sales_qty_7d ?? 0),
        sales_qty_90d:    Number(r.sales_qty_90d ?? 0),
        sales_qty_180d:   Number(r.sales_qty_180d ?? 0),
        sales_qty_12m:    Number(r.sales_qty_12m ?? 0),
        global_available: Number(r.global_available ?? 0),
        supplier_id:      r.supplier_contact_id ? String(r.supplier_contact_id) : null,
      };
    });
  }

  // Default: Cin7
  const rows = await ProductsRepository.list(businessId);
  return rows.map(p => ({
    ...cin7ProductToVariant(p),
    sales_qty_7d:     Number(p.sales_qty_7d   ?? 0),
    sales_qty_90d:    Number(p.sales_qty_90d  ?? 0),
    sales_qty_180d:   Number(p.sales_qty_180d ?? 0),
    sales_qty_12m:    Number(p.sales_qty_12m  ?? 0),
    global_available: Number(p.global_available ?? 0),
    supplier_id:      p.supplier_id ?? null,
  }));
}

// --- per-branch stock (used by Foresight planner for branch-level filtering) ---------------------

export async function getStockPerBranch(
  businessId: string,
  source?: string,
): Promise<VariantBranchStock[]> {
  const src = await resolveSource(businessId, source);

  if (src === 'solvantis') {
    const rows = await imsQuery<{ variant_id: string; location_id: number; qty_on_hand: number; qty_committed: number; qty_incoming: number }>(
      'SELECT variant_id, location_id, qty_on_hand, qty_committed, qty_incoming FROM ims_stock'
    );
    return rows.map(r => ({
      variant_id: String(r.variant_id),
      branch_id:  String(r.location_id),
      soh:        r.qty_on_hand   || 0,
      available:  (r.qty_on_hand  || 0) - (r.qty_committed || 0),
      incoming:   r.qty_incoming  || 0,
    }));
  }

  const rows = await StockRepository.list(businessId).catch(() => [] as any[]);
  return rows.map(r => ({
    variant_id: String(r.product_option_id),
    branch_id:  String(r.branch_id ?? ''),
    soh:        r.soh       || 0,
    available:  r.available || 0,
    incoming:   r.incoming  || 0,
  }));
}
