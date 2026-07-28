import { BrandProfileRepository } from '@/lib/db/BrandProfileRepository';
import { ImsLocationsRepo, ImsStockRepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';

export const CS_BUSINESS_TOOL_NAMES = [
  'find_customer_by_email',
  'get_customer_recent_orders',
  'get_order_details',
  'search_products',
  'get_stock_by_branch',
  'find_similar_products',
  'get_branch_details',
  'get_business_policies',
] as const;

export type CsBusinessToolName = typeof CS_BUSINESS_TOOL_NAMES[number];

export interface CsToolResult {
  tool: CsBusinessToolName;
  data: unknown;
  source: string;
}

type JsonObject = Record<string, unknown>;

export const CS_BUSINESS_TOOL_DECLARATIONS = [
  { name: 'find_customer_by_email', description: 'Find a customer contact by exact email address.', required: ['email'] },
  { name: 'get_customer_recent_orders', description: 'Get recent sales orders for a customer email address.', required: ['email'] },
  { name: 'get_order_details', description: 'Get customer-facing details and line items for an order number.', required: ['orderNumber'] },
  { name: 'search_products', description: 'Search active products and variants by product name, SKU, barcode, brand, or category.', required: ['query'] },
  { name: 'get_stock_by_branch', description: 'Get live stock on hand, committed, available, and incoming by branch for a SKU.', required: ['sku'] },
  { name: 'find_similar_products', description: 'Find active alternatives sharing the same supplier, brand, or category as a SKU.', required: ['sku'] },
  { name: 'get_branch_details', description: 'List active store and warehouse contact details.', required: [] },
  { name: 'get_business_policies', description: 'Get approved shipping and returns policies from the business profile.', required: [] },
] as const;

function requiredString(args: JsonObject, key: string, maxLength = 255): string {
  const value = typeof args[key] === 'string' ? args[key].trim() : '';
  if (!value) throw new Error(`${key} is required`);
  return value.slice(0, maxLength);
}

function optionalLimit(args: JsonObject, fallback: number, maximum: number): number {
  const raw = Number(args.limit);
  return Number.isFinite(raw) ? Math.max(1, Math.min(maximum, Math.trunc(raw))) : fallback;
}

function assertEmail(email: string): string {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('email must be a valid address');
  return email.toLowerCase();
}

async function findCustomerByEmail(businessId: string, args: JsonObject): Promise<CsToolResult> {
  const email = assertEmail(requiredString(args, 'email'));
  const rows = await imsQuery(
    `SELECT id, name, first_name, last_name, company, customer_code, customer_group,
            email, phone, mobile, city, state, postcode, country
       FROM ims_contacts
      WHERE business_id = ? AND LOWER(email) = ? AND is_active = 1
      LIMIT 5`,
    [businessId, email],
  );
  return { tool: 'find_customer_by_email', data: rows, source: 'IMS > Contacts' };
}

async function getCustomerRecentOrders(businessId: string, args: JsonObject): Promise<CsToolResult> {
  const email = assertEmail(requiredString(args, 'email'));
  const limit = optionalLimit(args, 10, 25);
  const rows = await imsQuery(
    `SELECT so.so_number, so.order_date, so.status, so.so_type, so.total_amount,
            so.shopify_order_name, so.fulfilled_date, l.name AS location_name
       FROM ims_sales_orders so
       LEFT JOIN ims_contacts c ON c.id = so.customer_id AND c.business_id = so.business_id
       LEFT JOIN ims_locations l ON l.id = so.location_id
      WHERE so.business_id = ? AND LOWER(c.email) = ?
      ORDER BY so.order_date DESC, so.id DESC
      LIMIT ${limit}`,
    [businessId, email],
  );
  return { tool: 'get_customer_recent_orders', data: rows, source: 'IMS > Sales Orders' };
}

async function getOrderDetails(businessId: string, args: JsonObject): Promise<CsToolResult> {
  const orderNumber = requiredString(args, 'orderNumber', 100);
  const orders = await imsQuery<any>(
    `SELECT so.id, so.so_number, so.order_date, so.status, so.so_type, so.total_amount,
            so.fulfilled_date, so.shopify_order_name, l.name AS location_name,
            c.name AS customer_name, c.email AS customer_email
       FROM ims_sales_orders so
       LEFT JOIN ims_contacts c ON c.id = so.customer_id AND c.business_id = so.business_id
       LEFT JOIN ims_locations l ON l.id = so.location_id
      WHERE so.business_id = ?
        AND (LOWER(so.so_number) = LOWER(?) OR LOWER(COALESCE(so.shopify_order_name, '')) = LOWER(?))
      LIMIT 1`,
    [businessId, orderNumber, orderNumber],
  );
  if (!orders[0]) return { tool: 'get_order_details', data: null, source: 'IMS > Sales Orders' };

  const items = await imsQuery(
    `SELECT COALESCE(p.name, soi.name) AS product_name, COALESCE(v.sku, soi.code) AS sku,
            CONCAT_WS(' / ', NULLIF(v.option1_value, ''), NULLIF(v.option2_value, ''), NULLIF(v.option3_value, '')) AS option_label,
            soi.qty_ordered, soi.qty_fulfilled, soi.unit_price, soi.discount_pct, soi.line_total
       FROM ims_sales_order_items soi
       LEFT JOIN ims_product_variants v ON v.variant_id = soi.variant_id
       LEFT JOIN ims_products p ON p.product_id = v.product_id
      WHERE soi.business_id = ? AND soi.so_id = ?
      ORDER BY soi.id
      LIMIT 100`,
    [businessId, orders[0].id],
  );
  const { id: _id, ...order } = orders[0];
  return { tool: 'get_order_details', data: { ...order, items }, source: 'IMS > Sales Orders' };
}

async function searchProducts(businessId: string, args: JsonObject): Promise<CsToolResult> {
  const query = requiredString(args, 'query', 120);
  const words = query.split(/\s+/).filter(Boolean).slice(0, 5);
  const limit = optionalLimit(args, 12, 25);
  const conditions = words.map(() => '(p.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ? OR p.brand LIKE ? OR p.category LIKE ?)');
  const params = words.flatMap(word => Array(5).fill(`%${word}%`));
  const rows = await imsQuery(
    `SELECT p.product_id, p.name AS product_name, p.brand, p.category, p.product_type,
            v.variant_id, v.sku, v.barcode,
            CONCAT_WS(' / ', NULLIF(v.option1_value, ''), NULLIF(v.option2_value, ''), NULLIF(v.option3_value, '')) AS option_label,
            CASE
              WHEN v.price_rrp_sale IS NOT NULL
               AND (v.discount_start_date IS NULL OR v.discount_start_date <= CURRENT_DATE)
               AND (v.discount_end_date IS NULL OR v.discount_end_date >= CURRENT_DATE)
              THEN v.price_rrp_sale ELSE v.price_rrp
            END AS retail_price_inc_gst
       FROM ims_products p
       JOIN ims_product_variants v ON v.product_id = p.product_id AND v.business_id = p.business_id
      WHERE p.business_id = ? AND p.is_active = 1 AND v.is_active = 1
        AND ${conditions.join(' AND ')}
      ORDER BY p.name, v.sku
      LIMIT ${limit}`,
    [businessId, ...params],
  );
  return { tool: 'search_products', data: rows, source: 'IMS > Products > All Products' };
}

async function getStockByBranch(businessId: string, args: JsonObject): Promise<CsToolResult> {
  const sku = requiredString(args, 'sku', 100);
  const variants = await imsQuery<{ variant_id: string }>(
    'SELECT variant_id FROM ims_product_variants WHERE business_id = ? AND LOWER(sku) = LOWER(?) LIMIT 2',
    [businessId, sku],
  );
  if (variants.length !== 1) {
    return { tool: 'get_stock_by_branch', data: [], source: 'IMS > The Stock Levels' };
  }
  const stock = await ImsStockRepo.list(variants[0].variant_id, undefined, businessId);
  const safeRows = stock.map(row => ({
    sku: row.sku,
    productName: row.product_name,
    option: row.variant_label,
    branch: row.location_name,
    onHand: Number(row.qty_on_hand ?? 0),
    committed: Number(row.qty_committed ?? 0),
    available: Number(row.available ?? 0),
    incoming: Number(row.qty_incoming ?? 0),
    updatedAt: row.updated_at,
  }));
  return { tool: 'get_stock_by_branch', data: safeRows, source: 'IMS > The Stock Levels (live ims_stock)' };
}

async function findSimilarProducts(businessId: string, args: JsonObject): Promise<CsToolResult> {
  const sku = requiredString(args, 'sku', 100);
  const limit = optionalLimit(args, 10, 20);
  const rows = await imsQuery(
    `SELECT p2.name AS product_name, p2.brand, p2.category, c2.name AS supplier_name,
            v2.sku,
            CONCAT_WS(' / ', NULLIF(v2.option1_value, ''), NULLIF(v2.option2_value, ''), NULLIF(v2.option3_value, '')) AS option_label,
            COALESCE(v2.price_rrp_sale, v2.price_rrp) AS retail_price_inc_gst,
            COALESCE(SUM(s.qty_on_hand - s.qty_committed), 0) AS available,
            ((p2.supplier_contact_id = p.supplier_contact_id AND p.supplier_contact_id IS NOT NULL) * 4
              + (p2.brand = p.brand AND COALESCE(p.brand, '') <> '') * 2
              + (p2.category = p.category AND COALESCE(p.category, '') <> '')) AS similarity_score
       FROM ims_product_variants source_v
       JOIN ims_products p ON p.product_id = source_v.product_id AND p.business_id = source_v.business_id
       JOIN ims_products p2 ON p2.business_id = p.business_id AND p2.product_id <> p.product_id
        AND (p2.supplier_contact_id = p.supplier_contact_id OR p2.brand = p.brand OR p2.category = p.category)
       JOIN ims_product_variants v2 ON v2.product_id = p2.product_id AND v2.business_id = p2.business_id AND v2.is_active = 1
       LEFT JOIN ims_contacts c2 ON c2.id = p2.supplier_contact_id
       LEFT JOIN ims_stock s ON s.variant_id = v2.variant_id AND s.business_id = p2.business_id
      WHERE source_v.business_id = ? AND LOWER(source_v.sku) = LOWER(?) AND p2.is_active = 1
      GROUP BY p2.product_id, v2.variant_id
      ORDER BY similarity_score DESC, available DESC, p2.name
      LIMIT ${limit}`,
    [businessId, sku],
  );
  return { tool: 'find_similar_products', data: rows, source: 'IMS > Products and The Stock Levels' };
}

async function getBranchDetails(businessId: string): Promise<CsToolResult> {
  const locations = await ImsLocationsRepo.list(businessId);
  const safeRows = locations.filter(location => location.is_active).map(location => ({
    name: location.name,
    code: location.code,
    address: location.address,
    phone: location.phone,
    city: location.city,
    state: location.state,
    postcode: location.postcode,
    country: location.country,
  }));
  return { tool: 'get_branch_details', data: safeRows, source: 'IMS > Locations' };
}

async function getBusinessPolicies(businessId: string): Promise<CsToolResult> {
  const profile = await BrandProfileRepository.get(businessId);
  return {
    tool: 'get_business_policies',
    data: profile ? {
      shippingPolicy: profile.shipping_policy ?? '',
      returnsPolicy: profile.returns_policy ?? '',
      loyaltyProgram: profile.loyalty_program ?? '',
      physicalBranches: profile.physical_branches ?? '',
      tone: profile.tone ?? '',
    } : null,
    source: 'Foresight > Brand Profile',
  };
}

const TOOL_HANDLERS: Record<CsBusinessToolName, (businessId: string, args: JsonObject) => Promise<CsToolResult>> = {
  find_customer_by_email: findCustomerByEmail,
  get_customer_recent_orders: getCustomerRecentOrders,
  get_order_details: getOrderDetails,
  search_products: searchProducts,
  get_stock_by_branch: getStockByBranch,
  find_similar_products: findSimilarProducts,
  get_branch_details: (businessId) => getBranchDetails(businessId),
  get_business_policies: (businessId) => getBusinessPolicies(businessId),
};

export async function executeCustomerServiceTool(input: {
  businessId: string;
  enabledTools: readonly string[];
  name: string;
  args?: JsonObject;
}): Promise<CsToolResult> {
  if (!CS_BUSINESS_TOOL_NAMES.includes(input.name as CsBusinessToolName)) {
    throw new Error(`Unknown customer-service tool: ${input.name}`);
  }
  if (!input.enabledTools.includes(input.name)) {
    throw new Error(`Customer-service tool is disabled: ${input.name}`);
  }
  if (!input.businessId.trim()) throw new Error('businessId is required');

  return TOOL_HANDLERS[input.name as CsBusinessToolName](input.businessId, input.args ?? {});
}