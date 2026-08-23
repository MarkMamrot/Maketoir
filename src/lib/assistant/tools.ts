import type { UserTier } from '@/lib/tierUtils';
import type { WholesaleBrandAccess } from '@/lib/wholesale/wholesaleAccess';
import { imsQuery } from '@/services/IMSMySQLService';

import type { AssistantAudience } from './policy';

export interface ImsAssistantPrincipal {
  audience: 'ims';
  businessId: string;
  userId: number;
  tier: UserTier;
}

export interface PosAssistantPrincipal {
  audience: 'pos';
  businessId: string;
  posUserId: number;
  locationId: number;
  locationName: string;
  registerId: number | null;
  registerName: string | null;
  tier: UserTier;
}

export interface WholesaleAssistantPrincipal {
  audience: 'wholesale';
  businessId: string;
  contactId: number;
  companyId: number;
  locationId: number;
  memberId: number;
  memberRole: 'owner' | 'admin' | 'buyer';
  brandAccess: WholesaleBrandAccess;
}

export type AssistantPrincipal = ImsAssistantPrincipal | PosAssistantPrincipal | WholesaleAssistantPrincipal;

export type AssistantToolName =
  | 'ims_product_lookup'
  | 'ims_order_summary'
  | 'ims_order_search'
  | 'ims_stock_alerts'
  | 'pos_product_lookup'
  | 'pos_session_context'
  | 'wholesale_catalogue_lookup'
  | 'wholesale_order_summary'
  | 'wholesale_account_summary';

export interface AssistantToolDefinition {
  name: AssistantToolName;
  description: string;
  audiences: AssistantAudience[];
  arguments: Record<string, string>;
}

export const assistantToolDefinitions: AssistantToolDefinition[] = [
  { name: 'ims_product_lookup', description: 'Find active products, variants, prices, and stock by product name, SKU, or barcode.', audiences: ['ims'], arguments: { search: 'Product name, SKU, or barcode' } },
  { name: 'ims_order_summary', description: 'Find one purchase or sales order by reference with bounded header and line-item detail.', audiences: ['ims'], arguments: { orderType: 'sales or purchase', reference: 'Order number, Shopify order name, or numeric ID' } },
  { name: 'ims_order_search', description: 'Find up to 20 recent purchase or sales orders by status and channel. Use status open for unfinished orders.', audiences: ['ims'], arguments: { orderType: 'sales or purchase', status: 'open, or an exact documented order status', channel: 'all, online, b2b, shopify, or native_shop for sales orders', days: 'Lookback from 1 to 90 days' } },
  { name: 'ims_stock_alerts', description: 'Find up to 20 active variants with low, zero, or negative available stock across active locations.', audiences: ['ims'], arguments: { mode: 'low, out, or negative', threshold: 'Low-stock available quantity threshold from 0 to 100' } },
  { name: 'pos_product_lookup', description: 'Find product price and stock at the signed-in POS location.', audiences: ['pos'], arguments: { search: 'Product name, SKU, or barcode' } },
  { name: 'pos_session_context', description: 'Return the signed-in POS location and register context.', audiences: ['pos'], arguments: {} },
  { name: 'wholesale_catalogue_lookup', description: 'Find currently approved wholesale catalogue variants, prices, and availability.', audiences: ['wholesale'], arguments: { search: 'Product name, SKU, or barcode' } },
  { name: 'wholesale_order_summary', description: 'Find an order owned by the signed-in wholesale account and member.', audiences: ['wholesale'], arguments: { reference: 'Draft or sales order reference' } },
  { name: 'wholesale_account_summary', description: 'Return buyer-safe company terms, assigned location, and member role.', audiences: ['wholesale'], arguments: {} },
];

function boundedSearch(value: unknown): string {
  return String(value ?? '').replace(/[%_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function asNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function allowedTools(audience: AssistantAudience): Set<AssistantToolName> {
  return new Set(assistantToolDefinitions.filter(tool => tool.audiences.includes(audience)).map(tool => tool.name));
}

export function getAssistantToolDefinitions(audience: AssistantAudience): AssistantToolDefinition[] {
  return assistantToolDefinitions.filter(tool => tool.audiences.includes(audience));
}

async function lookupImsProduct(principal: ImsAssistantPrincipal, searchValue: unknown) {
  const search = boundedSearch(searchValue);
  if (search.length < 2) throw new Error('Product search must contain at least two characters.');
  const like = `%${search}%`;
  const rows = await imsQuery<any>(
    `SELECT p.product_id, p.name, p.brand, v.variant_id, v.sku, v.barcode,
            CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant,
            v.price_rrp AS price,
            l.id AS location_id, l.name AS location_name,
            COALESCE(s.qty_on_hand, 0) AS qty_on_hand,
            COALESCE(s.qty_on_hand, 0) - COALESCE(s.qty_committed, 0) AS available
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       LEFT JOIN ims_stock s ON s.variant_id = v.variant_id
       LEFT JOIN ims_locations l ON l.id = s.location_id
      WHERE p.business_id = ? AND p.is_active = 1 AND v.is_active = 1
        AND (p.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)
      ORDER BY p.name, v.sku, l.name LIMIT 20`,
    [principal.businessId, like, like, like],
  );
  return rows.map(row => ({
    productId: row.product_id, name: row.name, brand: row.brand ?? null,
    variantId: row.variant_id, sku: row.sku ?? null, barcode: row.barcode ?? null,
    variant: row.variant || null, price: asNumber(row.price),
    locationId: row.location_id == null ? null : Number(row.location_id), location: row.location_name ?? null,
    quantityOnHand: asNumber(row.qty_on_hand), available: asNumber(row.available),
  }));
}

async function lookupImsOrder(principal: ImsAssistantPrincipal, args: Record<string, unknown>) {
  const reference = boundedSearch(args.reference);
  const orderType = String(args.orderType ?? '').toLowerCase() === 'purchase' ? 'purchase' : 'sales';
  if (!reference) throw new Error('Order reference is required.');
  const numericId = /^\d+$/.test(reference) ? Number(reference) : -1;
  if (orderType === 'purchase') {
    const rows = await imsQuery<any>(
      `SELECT po.id, po.po_number AS reference, po.status, po.order_date, po.expected_date,
              po.received_date, po.total_amount, COALESCE(c.name, po.supplier_name_raw) AS party,
              l.name AS location
         FROM ims_purchase_orders po
         LEFT JOIN ims_contacts c ON c.id = po.supplier_id
         JOIN ims_locations l ON l.id = po.location_id
        WHERE po.business_id = ? AND (po.id = ? OR po.po_number = ?)
        LIMIT 5`,
      [principal.businessId, numericId, reference],
    );
    if (rows.length === 0) return [];
    const orderIds = rows.map(row => Number(row.id));
    const items = await imsQuery<any>(
      `SELECT i.po_id AS order_id, p.name AS product, v.sku, i.qty_ordered, i.qty_received,
              i.unit_cost, i.line_total, i.notes
         FROM ims_purchase_order_items i
         JOIN ims_purchase_orders owner ON owner.id = i.po_id AND owner.business_id = ?
         JOIN ims_product_variants v ON v.variant_id = i.variant_id
         JOIN ims_products p ON p.product_id = v.product_id
        WHERE i.po_id IN (${orderIds.map(() => '?').join(',')})
        ORDER BY i.id LIMIT 40`,
      [principal.businessId, ...orderIds],
    );
    return rows.map(row => ({
      id: Number(row.id), reference: row.reference, type: 'purchase', status: row.status,
      orderDate: row.order_date, expectedDate: row.expected_date, receivedDate: row.received_date,
      totalAmount: asNumber(row.total_amount), party: row.party ?? null, location: row.location,
      items: items.filter(item => Number(item.order_id) === Number(row.id)).map(item => ({
        product: item.product, sku: item.sku ?? null, quantityOrdered: asNumber(item.qty_ordered),
        quantityReceived: asNumber(item.qty_received), unitCost: asNumber(item.unit_cost),
        lineTotal: asNumber(item.line_total), note: item.notes ?? null,
      })),
    }));
  }
  const rows = await imsQuery<any>(
    `SELECT so.id, so.so_number AS reference, so.status, so.order_date, so.expected_date,
            so.fulfilled_date, so.total_amount, c.name AS party, l.name AS location,
            so.so_type, so.sales_channel, so.shopify_order_name, so.payment_gateway,
            so.financial_status, so.refunded_amount
       FROM ims_sales_orders so
       LEFT JOIN ims_contacts c ON c.id = so.customer_id
       JOIN ims_locations l ON l.id = so.location_id
      WHERE so.business_id = ? AND (so.id = ? OR so.so_number = ? OR so.shopify_order_name = ?)
      LIMIT 5`,
    [principal.businessId, numericId, reference, reference],
  );
  if (rows.length === 0) return [];
  const orderIds = rows.map(row => Number(row.id));
  const items = await imsQuery<any>(
    `SELECT i.so_id AS order_id, p.name AS product, v.sku, i.qty_ordered, i.qty_fulfilled,
            i.unit_price, i.line_total, i.notes
       FROM ims_sales_order_items i
       JOIN ims_sales_orders owner ON owner.id = i.so_id AND owner.business_id = ?
       JOIN ims_product_variants v ON v.variant_id = i.variant_id
       JOIN ims_products p ON p.product_id = v.product_id
      WHERE i.so_id IN (${orderIds.map(() => '?').join(',')})
      ORDER BY i.id LIMIT 40`,
    [principal.businessId, ...orderIds],
  );
  return rows.map(row => ({
    id: Number(row.id), reference: row.reference, shopifyReference: row.shopify_order_name ?? null,
    type: row.so_type, channel: row.sales_channel ?? (row.shopify_order_name ? 'shopify' : null), status: row.status,
    orderDate: row.order_date, expectedDate: row.expected_date, fulfilledDate: row.fulfilled_date,
    totalAmount: asNumber(row.total_amount), refundedAmount: asNumber(row.refunded_amount),
    financialStatus: row.financial_status ?? null, paymentGateway: row.payment_gateway ?? null,
    party: row.party ?? null, location: row.location,
    items: items.filter(item => Number(item.order_id) === Number(row.id)).map(item => ({
      product: item.product, sku: item.sku ?? null, quantityOrdered: asNumber(item.qty_ordered),
      quantityFulfilled: asNumber(item.qty_fulfilled), unitPrice: asNumber(item.unit_price),
      lineTotal: asNumber(item.line_total), sourceLineTitle: item.notes ?? null,
    })),
  }));
}

async function searchImsOrders(principal: ImsAssistantPrincipal, args: Record<string, unknown>) {
  const orderType = String(args.orderType ?? '').toLowerCase() === 'purchase' ? 'purchase' : 'sales';
  const days = Math.min(90, Math.max(1, Math.round(asNumber(args.days) || 14)));
  const requestedStatus = boundedSearch(args.status).toLowerCase() || 'open';
  if (orderType === 'purchase') {
    const validStatuses = new Set(['draft', 'confirmed', 'partially_received', 'backordered', 'complete', 'cancelled']);
    const statusSql = requestedStatus === 'open'
      ? "po.status NOT IN ('complete','cancelled')"
      : validStatuses.has(requestedStatus) ? 'po.status = ?' : null;
    if (!statusSql) throw new Error('Unsupported purchase order status filter.');
    const params: unknown[] = [principal.businessId, days];
    if (requestedStatus !== 'open') params.push(requestedStatus);
    const rows = await imsQuery<any>(
      `SELECT po.id, po.po_number AS reference, po.status, po.order_date, po.expected_date,
              po.total_amount, COALESCE(c.name, po.supplier_name_raw) AS party, l.name AS location
         FROM ims_purchase_orders po
         LEFT JOIN ims_contacts c ON c.id = po.supplier_id
         JOIN ims_locations l ON l.id = po.location_id
        WHERE po.business_id = ? AND po.order_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
          AND ${statusSql}
        ORDER BY po.order_date DESC, po.id DESC LIMIT 20`,
      params,
    );
    return rows.map(row => ({ ...row, id: Number(row.id), type: 'purchase', total_amount: asNumber(row.total_amount) }));
  }

  const validStatuses = new Set(['draft', 'confirmed', 'partially_fulfilled', 'backordered', 'fulfilled', 'cancelled']);
  const statusSql = requestedStatus === 'open'
    ? "so.status NOT IN ('fulfilled','cancelled')"
    : validStatuses.has(requestedStatus) ? 'so.status = ?' : null;
  if (!statusSql) throw new Error('Unsupported sales order status filter.');
  const channel = boundedSearch(args.channel).toLowerCase() || 'all';
  const channelSql: Record<string, string> = {
    all: '1=1', online: "so.so_type = 'online'", b2b: "so.so_type = 'b2b'",
    shopify: 'so.shopify_order_id IS NOT NULL', native_shop: "so.sales_channel = 'native_shop'",
  };
  if (!channelSql[channel]) throw new Error('Unsupported sales channel filter.');
  const params: unknown[] = [principal.businessId, days];
  if (requestedStatus !== 'open') params.push(requestedStatus);
  const rows = await imsQuery<any>(
    `SELECT so.id, so.so_number AS reference, so.shopify_order_name, so.status, so.order_date,
            so.expected_date, so.total_amount, so.so_type, so.sales_channel,
            c.name AS party, l.name AS location
       FROM ims_sales_orders so
       LEFT JOIN ims_contacts c ON c.id = so.customer_id
       JOIN ims_locations l ON l.id = so.location_id
      WHERE so.business_id = ? AND so.order_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND ${statusSql} AND ${channelSql[channel]}
      ORDER BY so.order_date DESC, so.id DESC LIMIT 20`,
    params,
  );
  return rows.map(row => ({ ...row, id: Number(row.id), type: row.so_type, total_amount: asNumber(row.total_amount) }));
}

async function lookupImsStockAlerts(principal: ImsAssistantPrincipal, args: Record<string, unknown>) {
  const mode = boundedSearch(args.mode).toLowerCase() || 'low';
  if (!['low', 'out', 'negative'].includes(mode)) throw new Error('Unsupported stock alert mode.');
  const threshold = Math.min(100, Math.max(0, args.threshold == null ? 5 : asNumber(args.threshold)));
  const comparison = mode === 'negative' ? '< 0' : mode === 'out' ? '= 0' : '<= ?';
  const params: unknown[] = [principal.businessId];
  if (mode === 'low') params.push(threshold);
  const rows = await imsQuery<any>(
    `SELECT p.product_id, p.name, p.brand, v.variant_id, v.sku,
            COALESCE(SUM(CASE WHEN l.is_active = 1 THEN s.qty_on_hand ELSE 0 END), 0) AS quantity_on_hand,
            COALESCE(SUM(CASE WHEN l.is_active = 1 THEN s.qty_on_hand - s.qty_committed ELSE 0 END), 0) AS available
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       LEFT JOIN ims_stock s ON s.variant_id = v.variant_id
       LEFT JOIN ims_locations l ON l.id = s.location_id
      WHERE p.business_id = ? AND p.is_active = 1 AND v.is_active = 1 AND p.is_stock_item = 1
      GROUP BY p.product_id, p.name, p.brand, v.variant_id, v.sku
      HAVING available ${comparison}
      ORDER BY available ASC, p.name, v.sku LIMIT 20`,
    params,
  );
  return rows.map(row => ({
    productId: row.product_id, product: row.name, brand: row.brand ?? null,
    variantId: row.variant_id, sku: row.sku ?? null,
    quantityOnHand: asNumber(row.quantity_on_hand), available: asNumber(row.available),
  }));
}

async function lookupPosProduct(principal: PosAssistantPrincipal, searchValue: unknown) {
  const search = boundedSearch(searchValue);
  if (search.length < 2) throw new Error('Product search must contain at least two characters.');
  const like = `%${search}%`;
  const rows = await imsQuery<any>(
    `SELECT p.product_id, p.name, p.brand, v.variant_id, v.sku, v.barcode,
            CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant,
            v.price_rrp AS price, COALESCE(s.qty_on_hand, 0) AS qty_on_hand,
            COALESCE(s.qty_on_hand, 0) - COALESCE(s.qty_committed, 0) AS available
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
      WHERE p.business_id = ? AND p.is_active = 1 AND v.is_active = 1
        AND (p.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)
      ORDER BY p.name, v.sku LIMIT 12`,
    [principal.locationId, principal.businessId, like, like, like],
  );
  return rows.map(row => ({
    productId: row.product_id, name: row.name, brand: row.brand ?? null,
    variantId: row.variant_id, sku: row.sku ?? null, barcode: row.barcode ?? null,
    variant: row.variant || null, price: asNumber(row.price),
    location: principal.locationName, quantityOnHand: asNumber(row.qty_on_hand), available: asNumber(row.available),
  }));
}

async function lookupWholesaleCatalogue(principal: WholesaleAssistantPrincipal, searchValue: unknown) {
  if (principal.brandAccess.mode === 'none') return [];
  const search = boundedSearch(searchValue);
  if (search.length < 2) throw new Error('Catalogue search must contain at least two characters.');
  const conditions = [
    'p.business_id = ?', 'p.is_active = 1', 'v.is_active = 1', 'v.price_wholesale > 0',
    '(p.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)',
  ];
  const like = `%${search}%`;
  const params: unknown[] = [principal.businessId, like, like, like];
  if (principal.brandAccess.mode === 'selected') {
    conditions.push(`LOWER(TRIM(p.brand)) IN (${principal.brandAccess.brands.map(() => '?').join(',')})`);
    params.push(...principal.brandAccess.brands.map(brand => brand.toLocaleLowerCase('en-AU')));
  }
  const rows = await imsQuery<any>(
    `SELECT p.product_id, p.name, p.brand, p.allow_indent_wholesale,
            v.variant_id, v.sku, v.barcode,
            CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant,
            v.price_wholesale, v.pack_size,
            GREATEST(0, COALESCE(SUM(s.qty_on_hand), 0) - COALESCE(SUM(s.qty_committed), 0)) AS available
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       LEFT JOIN ims_stock s ON s.variant_id = v.variant_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY p.product_id, p.name, p.brand, p.allow_indent_wholesale,
               v.variant_id, v.sku, v.barcode, v.option1_value, v.option2_value, v.option3_value,
               v.price_wholesale, v.pack_size
      ORDER BY p.name, v.sku LIMIT 12`,
    params,
  );
  return rows.map(row => ({
    productId: row.product_id, name: row.name, brand: row.brand ?? null,
    variantId: row.variant_id, sku: row.sku ?? null, barcode: row.barcode ?? null,
    variant: row.variant || null, wholesalePrice: asNumber(row.price_wholesale),
    packSize: row.pack_size == null ? null : asNumber(row.pack_size), available: asNumber(row.available),
    indentAllowed: Boolean(row.allow_indent_wholesale),
  }));
}

async function lookupWholesaleOrder(principal: WholesaleAssistantPrincipal, referenceValue: unknown) {
  const reference = boundedSearch(referenceValue);
  if (!reference) throw new Error('Order reference is required.');
  const numericId = Number((reference.match(/\d+/) ?? ['-1'])[0]);
  const drafts = await imsQuery<any>(
    `SELECT 'draft' AS kind, o.id, CONCAT('Draft #', o.id) AS reference, o.status,
            o.total_amount, o.updated_at, wl.location_name AS location,
            COUNT(i.id) AS item_count, COALESCE(SUM(i.qty), 0) AS total_units
       FROM wholesale_draft_orders o
       JOIN ims_wholesale_member_locations ml
         ON ml.business_id = o.business_id AND ml.company_id = o.wholesale_company_id
        AND ml.member_id = o.wholesale_member_id AND ml.location_id = o.wholesale_location_id
       JOIN ims_wholesale_company_locations wl
         ON wl.id = ml.location_id AND wl.business_id = ml.business_id AND wl.company_id = ml.company_id AND wl.status = 'active'
       LEFT JOIN wholesale_draft_order_items i ON i.order_id = o.id
      WHERE o.business_id = ? AND o.contact_id = ? AND o.wholesale_company_id = ?
        AND o.wholesale_member_id = ? AND o.wholesale_location_id = ? AND o.id = ?
        AND o.status = 'draft' AND o.is_staff_preview_test = 0
      GROUP BY o.id LIMIT 1`,
    [principal.businessId, principal.contactId, principal.companyId, principal.memberId, principal.locationId, numericId],
  );
  if (drafts[0]) return drafts;
  return imsQuery<any>(
    `SELECT 'sales_order' AS kind, o.id, o.so_number AS reference, o.status,
            o.total_amount, o.order_date, o.expected_date, o.fulfilled_date, o.updated_at,
            wl.location_name AS location, COUNT(i.id) AS item_count,
            COALESCE(SUM(i.qty_ordered), 0) AS total_units, COALESCE(SUM(i.qty_fulfilled), 0) AS fulfilled_units
       FROM ims_sales_orders o
       JOIN ims_wholesale_member_locations ml
         ON ml.business_id = o.business_id AND ml.company_id = o.wholesale_company_id
        AND ml.member_id = o.wholesale_member_id AND ml.location_id = o.wholesale_location_id
       JOIN ims_wholesale_company_locations wl
         ON wl.id = ml.location_id AND wl.business_id = ml.business_id AND wl.company_id = ml.company_id AND wl.status = 'active'
       LEFT JOIN ims_sales_order_items i ON i.so_id = o.id
      WHERE o.business_id = ? AND o.customer_id = ? AND o.wholesale_company_id = ?
        AND o.wholesale_member_id = ? AND o.wholesale_location_id = ?
        AND (o.id = ? OR o.so_number = ?) AND o.is_staff_preview_test = 0
      GROUP BY o.id LIMIT 5`,
    [principal.businessId, principal.contactId, principal.companyId, principal.memberId, principal.locationId, numericId, reference],
  );
}

async function wholesaleAccountSummary(principal: WholesaleAssistantPrincipal) {
  const rows = await imsQuery<any>(
    `SELECT wc.company_name, wc.payment_terms, wc.on_account_limit,
            wl.location_name, wl.is_primary, wm.role AS member_role
       FROM ims_wholesale_company_members wm
       JOIN ims_wholesale_companies wc
         ON wc.id = wm.company_id AND wc.business_id = wm.business_id AND wc.status = 'active'
       JOIN ims_wholesale_member_locations wml
         ON wml.member_id = wm.id AND wml.business_id = wm.business_id AND wml.company_id = wm.company_id
       JOIN ims_wholesale_company_locations wl
         ON wl.id = wml.location_id AND wl.company_id = wm.company_id AND wl.business_id = wm.business_id AND wl.status = 'active'
      WHERE wm.id = ? AND wm.business_id = ? AND wm.contact_id = ?
        AND wm.company_id = ? AND wl.id = ? AND wm.is_active = 1 LIMIT 1`,
    [principal.memberId, principal.businessId, principal.contactId, principal.companyId, principal.locationId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    company: row.company_name, paymentTerms: row.payment_terms ?? null,
    onAccountLimit: row.on_account_limit == null ? null : asNumber(row.on_account_limit),
    assignedLocation: row.location_name, primaryLocation: Boolean(row.is_primary), role: row.member_role,
  };
}

export async function executeAssistantTool(
  principal: AssistantPrincipal,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!allowedTools(principal.audience).has(name as AssistantToolName)) {
    throw new Error('Assistant tool is not available for this audience.');
  }
  switch (name as AssistantToolName) {
    case 'ims_product_lookup': return lookupImsProduct(principal as ImsAssistantPrincipal, args.search);
    case 'ims_order_summary': return lookupImsOrder(principal as ImsAssistantPrincipal, args);
    case 'ims_order_search': return searchImsOrders(principal as ImsAssistantPrincipal, args);
    case 'ims_stock_alerts': return lookupImsStockAlerts(principal as ImsAssistantPrincipal, args);
    case 'pos_product_lookup': return lookupPosProduct(principal as PosAssistantPrincipal, args.search);
    case 'pos_session_context': {
      const pos = principal as PosAssistantPrincipal;
      return { location: pos.locationName, locationId: pos.locationId, register: pos.registerName, registerId: pos.registerId, tier: pos.tier };
    }
    case 'wholesale_catalogue_lookup': return lookupWholesaleCatalogue(principal as WholesaleAssistantPrincipal, args.search);
    case 'wholesale_order_summary': return lookupWholesaleOrder(principal as WholesaleAssistantPrincipal, args.reference);
    case 'wholesale_account_summary': return wholesaleAccountSummary(principal as WholesaleAssistantPrincipal);
    default: throw new Error('Unknown assistant tool.');
  }
}