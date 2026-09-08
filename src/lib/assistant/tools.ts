import type { UserTier } from '@/lib/tierUtils';
import type { WholesaleBrandAccess } from '@/lib/wholesale/wholesaleAccess';
import {
  ContactCrmNotFoundError,
  ContactCrmValidationError,
  getContactCrmProfile,
  getContactCrmTimeline,
} from '@/lib/ims/contactCrmService';
import { loadStockAvailabilityRows } from '@/lib/ims/stockAvailabilityQuery';
import { summarizeStockAvailabilityRow, type StockAvailabilityIssue } from '@/lib/ims/stockAvailabilityWorkbench';
import { loadAssistantSalesPerformance } from '@/lib/ims/salesSummaryQuery';
import {
  loadPurchaseOrderAging,
  loadReorderForecast,
  type PurchaseOrderAgingMode,
  type ReorderFilterType,
  type ReorderSalesWindow,
} from '@/lib/ims/purchasingInsightsQuery';
import { loadShopifyDiagnostics, loadXeroDiagnostics } from '@/lib/ims/integrationDiagnostics';
import { getBusinessFeatureFlags } from '@/lib/businessFeatures';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import {
  loadAssistantMarketingPerformance,
  loadAssistantMarketingRecommendations,
} from '@/lib/foresight/assistantInsights';
import type { RecommendationState } from '@/lib/foresight/types';
import {
  assertShopifyEnabled,
  assertXeroAccountingEnabled,
  isOnlineChannelDisabledError,
  isXeroAccountingDisabledError,
} from '@/lib/ims/businessOperations';
import { loadPosRecentTransactions, loadPosRegisterStatus } from '@/lib/pos/assistantOperations';
import { imsQuery } from '@/services/IMSMySQLService';

import type { AssistantAudience } from './policy';
import {
  hasAssistantToolPrincipalAccess,
  isAssistantToolAvailable,
  type AssistantToolFeatureAvailability,
} from './toolAccess';

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
  | 'ims_inventory_position'
  | 'ims_stock_movement_history'
  | 'ims_stock_allocation_exceptions'
  | 'ims_customer_lookup'
  | 'ims_customer_activity'
  | 'ims_sales_performance'
  | 'ims_reorder_forecast'
  | 'ims_purchase_order_aging'
  | 'ims_xero_sync_diagnostics'
  | 'ims_shopify_sync_diagnostics'
  | 'ims_marketing_performance'
  | 'ims_marketing_recommendations'
  | 'pos_product_lookup'
  | 'pos_session_context'
  | 'pos_register_status'
  | 'pos_recent_transactions'
  | 'wholesale_catalogue_lookup'
  | 'wholesale_order_summary'
  | 'wholesale_account_summary';

export interface AssistantToolDefinition {
  name: AssistantToolName;
  description: string;
  audiences: AssistantAudience[];
  arguments: Record<string, string>;
  maxRows?: number;
}

export class AssistantToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantToolValidationError';
  }
}

export class AssistantToolAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantToolAccessError';
  }
}

export const assistantToolDefinitions: AssistantToolDefinition[] = [
  { name: 'ims_product_lookup', description: 'Find active products, variants, prices, and stock by product name, SKU, or barcode.', audiences: ['ims'], arguments: { search: 'Product name, SKU, or barcode' } },
  { name: 'ims_order_summary', description: 'Find one purchase or sales order by reference with bounded header and line-item detail.', audiences: ['ims'], arguments: { orderType: 'sales or purchase', reference: 'Order number, Shopify order name, or numeric ID' } },
  { name: 'ims_order_search', description: 'Find up to 20 recent purchase or sales orders by status and channel. Use status open for unfinished orders.', audiences: ['ims'], arguments: { orderType: 'sales or purchase', status: 'open, or an exact documented order status', channel: 'all, online, b2b, shopify, or native_shop for sales orders', days: 'Lookback from 1 to 90 days' } },
  { name: 'ims_stock_alerts', description: 'Find up to 20 active variants with low, zero, or negative available stock across active locations.', audiences: ['ims'], arguments: { mode: 'low, out, or negative', threshold: 'Low-stock available quantity threshold from 0 to 100' } },
  { name: 'ims_inventory_position', description: 'Find up to 30 active product variants by name, SKU, or barcode and show stock on hand, committed, available, incoming, reorder settings, and weighted-average cost by active location.', audiences: ['ims'], arguments: { search: 'Product name, SKU, or barcode', location: 'Optional exact active location name' }, maxRows: 30 },
  { name: 'ims_stock_movement_history', description: 'Find up to 50 recent stock movements for a product name, SKU, or barcode, with location, quantity change, resulting stock on hand, movement type, cost, and source reference.', audiences: ['ims'], arguments: { search: 'Product name, SKU, or barcode', location: 'Optional exact active location name', days: 'Lookback from 1 to 365 days' }, maxRows: 50 },
  { name: 'ims_stock_allocation_exceptions', description: 'Find up to 50 unfinished sales-order lines with at-risk, overdue, unsourced, ready, incoming, or held stock-allocation issues. Customer and supplier identities are omitted.', audiences: ['ims'], arguments: { issue: 'all, at_risk, overdue, unsourced, ready, incoming, or held' }, maxRows: 50 },
  { name: 'ims_customer_lookup', description: 'Find up to 10 active customer-capable contacts by display name, company, or customer code. Contact channels and addresses are omitted.', audiences: ['ims'], arguments: { search: 'Customer display name, company, or customer code' }, maxRows: 10 },
  { name: 'ims_customer_activity', description: 'Summarise one verified customer contact and return up to 30 recent sales, orders, credits, store-credit entries, and loyalty activity. Free-text CRM notes and staff identities are omitted.', audiences: ['ims'], arguments: { contactId: 'Positive contact ID returned by ims_customer_lookup', days: 'Lookback from 1 to 730 days' }, maxRows: 30 },
  { name: 'ims_sales_performance', description: 'Summarise tax-inclusive sales by active location for up to 365 days, including quantity, revenue, attached COGS, gross profit on cost-covered sales, and COGS coverage. No customer records are returned.', audiences: ['ims'], arguments: { days: 'Lookback from 1 to 365 days', locationIds: 'Optional comma-separated active location IDs, maximum 20' }, maxRows: 20 },
  { name: 'ims_reorder_forecast', description: 'Find up to 30 nonzero Order Planner suggestions for one supplier or brand using sales velocity, supplier lead time, available stock, incoming stock, and pack size. Suggestions require staff review and do not create a purchase order.', audiences: ['ims'], arguments: { filterType: 'supplier or brand', filterValue: 'Supplier or brand name, at least two characters', salesWindowDays: '7, 90, 180, or 365; defaults to 90', orderFrequencyDays: 'Ordering cadence from 1 to 365 days; defaults to 30' }, maxRows: 30 },
  { name: 'ims_purchase_order_aging', description: 'Find up to 30 open purchase orders with outstanding quantities, supplier, active receiving location, order age, expected date, overdue days, and outstanding tax-exclusive value. Contact channels, notes, invoices, files, and payment data are omitted.', audiences: ['ims'], arguments: { mode: 'all, overdue, or due_soon', supplier: 'Optional supplier-name search', dueSoonDays: 'Due-soon horizon from 1 to 90 days; defaults to 14' }, maxRows: 30 },
  { name: 'ims_xero_sync_diagnostics', description: 'Check local Xero connection readiness, up to 30 currently queued source documents, and categorized recent failed or skipped sync events. Does not contact Xero, retry work, or expose raw error details, tokens, contacts, or payloads.', audiences: ['ims'], arguments: { days: 'Failure-history lookback from 1 to 365 days; defaults to 30' }, maxRows: 30 },
  { name: 'ims_shopify_sync_diagnostics', description: 'Check local Shopify connection readiness, order-sync and webhook-secret configuration, catalogue linkage counts, and up to 30 recent sync outcomes. Does not contact Shopify, inspect live webhook registration, make changes, or expose credentials and raw payloads.', audiences: ['ims'], arguments: {}, maxRows: 30 },
  { name: 'ims_marketing_performance', description: 'Summarise 1 to 90 complete business days of governed paid-media and authoritative commerce metrics, including spend, platform attribution, MER, tax-inclusive sales, extracted tax, and data-quality caveats. Account and campaign identities are omitted.', audiences: ['ims'], arguments: { days: 'Complete-day lookback from 1 to 90 days; defaults to 30' } },
  { name: 'ims_marketing_recommendations', description: 'Find up to 20 stored Intel & Automation marketing recommendations with sanitized evidence, review state, confidence, and operational follow-up status. Does not generate, approve, reject, execute, or modify recommendations.', audiences: ['ims'], arguments: { state: 'open, all, or an exact recommendation state' }, maxRows: 20 },
  { name: 'pos_product_lookup', description: 'Find product price and stock at the signed-in POS location.', audiences: ['pos'], arguments: { search: 'Product name, SKU, or barcode' } },
  { name: 'pos_session_context', description: 'Return the signed-in POS location and register context.', audiences: ['pos'], arguments: {} },
  { name: 'pos_register_status', description: 'Check the verified POS register session, tax-inclusive sales totals, extracted GST, expected payment-method takings net of petty cash, and whether End of Day counts have been saved. Staff and customer identities are omitted.', audiences: ['pos'], arguments: {} },
  { name: 'pos_recent_transactions', description: 'Find up to 20 completed transactions assigned to the verified POS register over the last 1 to 30 days. Returns anonymous transaction totals, item counts, and payment method names only.', audiences: ['pos'], arguments: { days: 'Lookback from 1 to 30 days; defaults to 7' }, maxRows: 20 },
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

export function getAssistantToolDefinitions(
  principal: AssistantPrincipal,
  features: AssistantToolFeatureAvailability = {},
): AssistantToolDefinition[] {
  return assistantToolDefinitions.filter(tool => isAssistantToolAvailable(principal, tool.name, features));
}

async function lookupImsProduct(principal: ImsAssistantPrincipal, searchValue: unknown) {
  const search = boundedSearch(searchValue);
  if (search.length < 2) throw new AssistantToolValidationError('Product search must contain at least two characters.');
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
  if (!reference) throw new AssistantToolValidationError('Order reference is required.');
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
    if (!statusSql) throw new AssistantToolValidationError('Unsupported purchase order status filter.');
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
  if (!statusSql) throw new AssistantToolValidationError('Unsupported sales order status filter.');
  const channel = boundedSearch(args.channel).toLowerCase() || 'all';
  const channelSql: Record<string, string> = {
    all: '1=1', online: "so.so_type = 'online'", b2b: "so.so_type = 'b2b'",
    shopify: 'so.shopify_order_id IS NOT NULL', native_shop: "so.sales_channel = 'native_shop'",
  };
  if (!channelSql[channel]) throw new AssistantToolValidationError('Unsupported sales channel filter.');
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
  if (!['low', 'out', 'negative'].includes(mode)) throw new AssistantToolValidationError('Unsupported stock alert mode.');
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

async function lookupImsInventoryPosition(principal: ImsAssistantPrincipal, args: Record<string, unknown>) {
  const search = boundedSearch(args.search);
  if (search.length < 2) throw new AssistantToolValidationError('Inventory search must contain at least two characters.');
  const location = boundedSearch(args.location);
  const like = `%${search}%`;
  const locationSql = location ? 'AND l.name = ?' : '';
  const params: unknown[] = [principal.businessId, like, like, like];
  if (location) params.push(location);
  const rows = await imsQuery<any>(
    `SELECT p.product_id, p.name, p.brand, v.variant_id, v.sku, v.barcode,
            CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant,
            l.id AS location_id, l.name AS location_name,
            COALESCE(s.qty_on_hand, 0) AS qty_on_hand,
            COALESCE(s.qty_committed, 0) AS qty_committed,
            COALESCE(s.qty_on_hand, 0) - COALESCE(s.qty_committed, 0) AS available,
            COALESCE(s.qty_incoming, 0) AS qty_incoming,
            COALESCE(s.min_qty, 0) AS min_qty,
            COALESCE(s.reorder_qty, 0) AS reorder_qty,
            COALESCE(s.avg_cost, v.avg_cost, 0) AS avg_cost
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = ?
       JOIN ims_stock s ON s.variant_id = v.variant_id
       JOIN ims_locations l ON l.id = s.location_id AND l.is_active = 1
      WHERE p.is_active = 1 AND v.is_active = 1
        AND (p.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)
        ${locationSql}
      ORDER BY p.name, v.sku, l.name LIMIT 30`,
    params,
  );
  return rows.map(row => ({
    productId: row.product_id,
    product: row.name,
    brand: row.brand ?? null,
    variantId: row.variant_id,
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    variant: row.variant || null,
    locationId: Number(row.location_id),
    location: row.location_name,
    quantityOnHand: asNumber(row.qty_on_hand),
    committed: asNumber(row.qty_committed),
    available: asNumber(row.available),
    incoming: asNumber(row.qty_incoming),
    minimumQuantity: asNumber(row.min_qty),
    reorderQuantity: asNumber(row.reorder_qty),
    weightedAverageCost: asNumber(row.avg_cost),
  }));
}

async function lookupImsStockMovementHistory(principal: ImsAssistantPrincipal, args: Record<string, unknown>) {
  const search = boundedSearch(args.search);
  if (search.length < 2) throw new AssistantToolValidationError('Movement search must contain at least two characters.');
  const location = boundedSearch(args.location);
  const days = Math.min(365, Math.max(1, Math.round(asNumber(args.days) || 90)));
  const like = `%${search}%`;
  const locationSql = location ? 'AND l.name = ?' : '';
  const params: unknown[] = [principal.businessId, like, like, like, days];
  if (location) params.push(location);
  const rows = await imsQuery<any>(
    `SELECT m.id, m.created_at, m.movement_type, m.reference_type, m.reference_id,
            m.qty_change, m.qty_after_soh, m.unit_cost, m.channel, m.notes,
            p.name AS product_name, p.brand, v.variant_id, v.sku,
            CONCAT_WS(' / ', NULLIF(v.option1_value,''), NULLIF(v.option2_value,''), NULLIF(v.option3_value,'')) AS variant,
            l.id AS location_id, l.name AS location_name,
            po.po_number, so.so_number, cn.cn_number, scn.scn_number,
            build_batch.build_number, reversal.reversal_number
       FROM ims_stock_movements m
       JOIN ims_product_variants v ON v.variant_id = m.variant_id
       JOIN ims_products p ON p.product_id = v.product_id AND p.business_id = ?
       JOIN ims_locations l ON l.id = m.location_id
       LEFT JOIN ims_purchase_orders po ON po.id = m.reference_id AND m.reference_type = 'purchase_order' AND po.business_id = p.business_id
       LEFT JOIN ims_sales_orders so ON so.id = m.reference_id AND m.reference_type = 'sales_order' AND so.business_id = p.business_id
       LEFT JOIN ims_credit_notes cn ON cn.id = m.reference_id AND m.reference_type = 'credit_note' AND cn.business_id = p.business_id
       LEFT JOIN ims_supplier_credit_notes scn ON scn.id = m.reference_id AND m.reference_type = 'supplier_credit_note' AND scn.business_id = p.business_id
      LEFT JOIN ims_product_build_items build_item ON build_item.id = m.reference_id AND m.reference_type = 'product_build' AND build_item.business_id = p.business_id
      LEFT JOIN ims_product_build_reversals reversal ON reversal.id = m.reference_id AND m.reference_type = 'product_build_reversal' AND reversal.business_id = p.business_id
      LEFT JOIN ims_product_build_items reversal_item ON reversal_item.id = reversal.build_item_id AND reversal_item.business_id = p.business_id
      LEFT JOIN ims_product_build_batches build_batch ON build_batch.id = COALESCE(build_item.batch_id, reversal_item.batch_id) AND build_batch.business_id = p.business_id
      WHERE (p.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)
        AND m.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        ${locationSql}
      ORDER BY m.created_at DESC, m.id DESC LIMIT 50`,
    params,
  );
  return rows.map(row => ({
    movementId: Number(row.id),
    occurredAt: row.created_at,
    product: row.product_name,
    brand: row.brand ?? null,
    variantId: row.variant_id,
    sku: row.sku ?? null,
    variant: row.variant || null,
    locationId: Number(row.location_id),
    location: row.location_name,
    movementType: row.movement_type,
    channel: row.channel ?? null,
    quantityChange: asNumber(row.qty_change),
    quantityOnHandAfter: asNumber(row.qty_after_soh),
    unitCost: row.unit_cost == null ? null : asNumber(row.unit_cost),
    referenceType: row.reference_type,
    reference: row.po_number ?? row.so_number ?? row.cn_number ?? row.scn_number ?? row.reversal_number ?? row.build_number ?? row.reference_id ?? null,
    note: row.notes ?? null,
  }));
}

async function lookupImsStockAllocationExceptions(principal: ImsAssistantPrincipal, args: Record<string, unknown>) {
  const issue = boundedSearch(args.issue).toLowerCase() || 'all';
  const validIssues = new Set<StockAvailabilityIssue | 'all'>(['all', 'at_risk', 'overdue', 'unsourced', 'ready', 'incoming', 'held']);
  if (!validIssues.has(issue as StockAvailabilityIssue | 'all')) {
    throw new AssistantToolValidationError('Unsupported stock allocation issue filter.');
  }
  const rows = await loadStockAvailabilityRows(principal.businessId);
  return rows
    .map(row => ({ ...row, ...summarizeStockAvailabilityRow(row) }))
    .filter(row => issue === 'all' || row.issues.includes(issue as StockAvailabilityIssue))
    .slice(0, 50)
    .map(row => ({
      salesOrderId: Number(row.so_id),
      salesOrderItemId: Number(row.so_item_id),
      salesOrder: row.so_number,
      orderStatus: row.status,
      expectedDate: row.expected_date,
      product: row.product_name,
      variantId: row.variant_id,
      sku: row.sku ?? null,
      variant: row.variant_label || null,
      locationId: Number(row.location_id),
      location: row.location_name,
      outstanding: row.outstanding,
      protected: row.protected,
      ready: row.ready,
      incoming: row.incoming,
      unsourced: row.unsourced,
      quantityOnHand: Number(row.qty_on_hand),
      committed: Number(row.qty_committed),
      totalIncoming: Number(row.qty_incoming),
      allocationCount: Number(row.allocation_count ?? 0),
      earliestIncomingDate: row.earliest_incoming_date,
      issues: row.issues,
    }));
}

async function lookupImsCustomer(principal: ImsAssistantPrincipal, searchValue: unknown) {
  const search = boundedSearch(searchValue);
  if (search.length < 2) throw new AssistantToolValidationError('Customer search must contain at least two characters.');
  const like = `%${search}%`;
  const rows = await imsQuery<any>(
    `SELECT id, type, name, company, customer_code, customer_group, loyalty_member
       FROM ims_contacts
      WHERE business_id = ? AND is_active = 1
        AND type IN ('retail_customer','b2b_customer','both')
        AND (name LIKE ? OR company LIKE ? OR customer_code LIKE ?)
      ORDER BY name, id LIMIT 10`,
    [principal.businessId, like, like, like],
  );
  return rows.map(row => ({
    contactId: Number(row.id),
    displayName: row.name,
    company: row.company ?? null,
    customerCode: row.customer_code ?? null,
    customerType: row.type,
    customerGroup: row.customer_group ?? null,
    loyaltyMember: Boolean(row.loyalty_member),
  }));
}

async function lookupImsCustomerActivity(principal: ImsAssistantPrincipal, args: Record<string, unknown>) {
  const contactId = Math.round(asNumber(args.contactId));
  if (contactId <= 0) throw new AssistantToolValidationError('A positive customer contact ID is required.');
  const days = Math.min(730, Math.max(1, Math.round(asNumber(args.days) || 365)));
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const [profile, timeline] = await Promise.all([
      getContactCrmProfile(principal.businessId, contactId),
      getContactCrmTimeline(principal.businessId, contactId, {
        categories: ['sale', 'order', 'credit', 'loyalty'],
        from: fromDate,
        limit: 30,
      }),
    ]);
    return {
      customer: {
        contactId,
        displayName: profile.contact.name,
        company: profile.contact.company ?? null,
        customerCode: profile.contact.customer_code ?? null,
        customerType: profile.contact.type,
        active: Boolean(profile.contact.is_active),
      },
      summaries: {
        posTransactions: Number(profile.summaries.pos?.transaction_count ?? 0),
        posNetTotal: Number(profile.summaries.pos?.net_total ?? 0),
        salesOrders: Number(profile.summaries.salesOrders.order_count ?? 0),
        salesOrderTotal: Number(profile.summaries.salesOrders.order_total ?? 0),
        creditNotes: Number(profile.summaries.creditNotes.credit_count ?? 0),
        creditTotal: Number(profile.summaries.creditNotes.credit_total ?? 0),
        storeCreditBalance: Number(profile.summaries.storeCredit ?? 0),
        loyaltyPoints: profile.summaries.loyalty == null ? null : Number(profile.summaries.loyalty.balance_points ?? 0),
        openTasks: Number(profile.summaries.tasks.open_count ?? 0),
        overdueTasks: Number(profile.summaries.tasks.overdue_count ?? 0),
      },
      activity: timeline.entries.map(entry => ({
        category: entry.category,
        activityType: entry.activityType,
        occurredAt: entry.occurredAt,
        title: entry.title,
        status: entry.status,
        amount: entry.amount,
        points: entry.points,
        source: entry.source,
      })),
      fromDate,
      truncated: timeline.truncated,
    };
  } catch (error) {
    if (error instanceof ContactCrmNotFoundError || error instanceof ContactCrmValidationError) {
      throw new AssistantToolValidationError(error.message);
    }
    throw error;
  }
}

async function lookupImsSalesPerformance(principal: ImsAssistantPrincipal, args: Record<string, unknown>) {
  const days = Math.min(365, Math.max(1, Math.round(asNumber(args.days) || 30)));
  const rawLocationIds = Array.isArray(args.locationIds)
    ? args.locationIds
    : String(args.locationIds ?? '').split(',');
  const locationIds = [...new Set(rawLocationIds
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value > 0))]
    .slice(0, 20);
  const toDate = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const result = await loadAssistantSalesPerformance({
    businessId: principal.businessId,
    fromDate,
    toDate,
    locationIds: locationIds.length ? locationIds : undefined,
  });
  return {
    fromDate,
    toDate,
    rows: result.rows.slice(0, 20),
    totals: result.totals,
    truncated: result.rows.length > 20,
    marginBasis: 'Gross profit uses tax-exclusive covered sales and attached movement costs. Coverage below 100% means margin is not available for every sale in the period.',
  };
}
async function lookupImsReorderForecast(principal: ImsAssistantPrincipal, args: Record<string, unknown>) {
    const filterType = String(args.filterType ?? '').toLocaleLowerCase('en-AU');
    if (filterType !== 'supplier' && filterType !== 'brand') {
      throw new AssistantToolValidationError('Reorder forecast filterType must be supplier or brand.');
    }
    const filterValue = boundedSearch(args.filterValue);
    if (filterValue.length < 2) {
      throw new AssistantToolValidationError('Supplier or brand search must contain at least two characters.');
    }
    const requestedWindow = asNumber(args.salesWindowDays) || 90;
    if (![7, 90, 180, 365].includes(requestedWindow)) {
      throw new AssistantToolValidationError('Sales window must be 7, 90, 180, or 365 days.');
    }
    const orderFrequencyDays = Math.min(365, Math.max(1, Math.round(asNumber(args.orderFrequencyDays) || 30)));
    const result = await loadReorderForecast({
      businessId: principal.businessId,
      filterType: filterType as ReorderFilterType,
      filterValue,
      salesWindowDays: requestedWindow as ReorderSalesWindow,
      orderFrequencyDays,
    });
    return {
      filterType,
      filterValue,
      salesWindowDays: requestedWindow,
      orderFrequencyDays,
      ...result,
      method: 'Average daily sales x (order frequency + supplier lead time), less available and incoming stock, then rounded to pack size. Suggestions require staff review.',
    };
}

async function lookupImsPurchaseOrderAging(principal: ImsAssistantPrincipal, args: Record<string, unknown>) {
    const mode = String(args.mode ?? 'all').toLocaleLowerCase('en-AU');
    if (!['all', 'overdue', 'due_soon'].includes(mode)) {
      throw new AssistantToolValidationError('Purchase order aging mode must be all, overdue, or due_soon.');
    }
    const supplierSearch = boundedSearch(args.supplier);
    const dueSoonDays = Math.min(90, Math.max(1, Math.round(asNumber(args.dueSoonDays) || 14)));
    const result = await loadPurchaseOrderAging({
      businessId: principal.businessId,
      mode: mode as PurchaseOrderAgingMode,
      supplierSearch: supplierSearch || undefined,
      dueSoonDays,
      limit: 30,
    });
    return {
      mode,
      dueSoonDays,
      supplierSearch: supplierSearch || null,
      ...result,
      valueBasis: 'Outstanding value is tax-exclusive in the purchase order currency. Foreign-currency rows include their recorded exchange rate.',
    };
}

async function lookupImsXeroDiagnostics(principal: ImsAssistantPrincipal, args: Record<string, unknown>) {
  try {
    await assertXeroAccountingEnabled(principal.businessId);
  } catch (error) {
    if (isXeroAccountingDisabledError(error)) throw new AssistantToolAccessError(error.message);
    throw error;
  }
  const days = Math.min(365, Math.max(1, Math.round(asNumber(args.days) || 30)));
  return {
    days,
    ...await loadXeroDiagnostics({ businessId: principal.businessId, days, limit: 30 }),
    scope: 'Local Solvantis status only. Xero was not contacted and historical failures may already have a later successful retry.',
  };
}

async function lookupImsShopifyDiagnostics(principal: ImsAssistantPrincipal) {
  try {
    await assertShopifyEnabled(principal.businessId);
  } catch (error) {
    if (isOnlineChannelDisabledError(error)) throw new AssistantToolAccessError(error.message);
    throw error;
  }
  return {
    ...await loadShopifyDiagnostics({ businessId: principal.businessId, limit: 30 }),
    scope: 'Local Solvantis status only. Shopify and live webhook registration were not contacted.',
  };
}

async function assertMarketingEnabled(businessId: string) {
  const features = await getBusinessFeatureFlags(businessId);
  if (!features['foresight.marketing']) {
    throw new AssistantToolAccessError('Intel & Automation Marketing is not enabled for this business.');
  }
}

function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function businessToday(businessId: string): Promise<string> {
  const timeZone = await getBusinessTimeZone(businessId);
  return new Date().toLocaleDateString('sv-SE', { timeZone });
}

async function lookupImsMarketingPerformance(principal: ImsAssistantPrincipal, args: Record<string, unknown>) {
  await assertMarketingEnabled(principal.businessId);
  const days = Math.min(90, Math.max(1, Math.round(asNumber(args.days) || 30)));
  const today = await businessToday(principal.businessId);
  const toDate = shiftIsoDate(today, -1);
  const fromDate = shiftIsoDate(toDate, -(days - 1));
  return {
    days,
    ...await loadAssistantMarketingPerformance({ businessId: principal.businessId, fromDate, toDate }),
    scope: 'Stored governed observations through the latest complete business day. Platform-attributed revenue is not authoritative commerce revenue, and no advertising platform was contacted live.',
  };
}

async function lookupImsMarketingRecommendations(principal: ImsAssistantPrincipal, args: Record<string, unknown>) {
  await assertMarketingEnabled(principal.businessId);
  const requestedState = String(args.state ?? '').trim().toLocaleLowerCase('en-AU') || 'open';
  const allStates: RecommendationState[] = [
    'shadow', 'pending_approval', 'approved', 'executing', 'succeeded', 'failed', 'compensated', 'rejected',
  ];
  const states = requestedState === 'all'
    ? allStates
    : requestedState === 'open'
      ? allStates.filter(state => !['compensated', 'rejected'].includes(state))
      : allStates.includes(requestedState as RecommendationState)
        ? [requestedState as RecommendationState]
        : null;
  if (!states) throw new AssistantToolValidationError('Recommendation state must be open, all, or an exact supported state.');
  const today = await businessToday(principal.businessId);
  return {
    state: requestedState,
    ...await loadAssistantMarketingRecommendations({
      businessId: principal.businessId,
      businessToday: today,
      states,
      limit: 20,
    }),
    scope: 'Stored recommendation evidence and workflow status only. This check does not generate, approve, reject, execute, roll back, or verify live external platform state.',
  };
}


async function lookupPosProduct(principal: PosAssistantPrincipal, searchValue: unknown) {
  const search = boundedSearch(searchValue);
  if (search.length < 2) throw new AssistantToolValidationError('Product search must contain at least two characters.');
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

function requirePosRegister(principal: PosAssistantPrincipal): number {
  if (!Number.isInteger(principal.registerId) || Number(principal.registerId) <= 0) {
    throw new AssistantToolAccessError('This POS session does not have a verified register assigned.');
  }
  return Number(principal.registerId);
}

async function lookupPosRegisterStatus(principal: PosAssistantPrincipal) {
  const registerId = requirePosRegister(principal);
  const result = await loadPosRegisterStatus({
    businessId: principal.businessId,
    locationId: principal.locationId,
    registerId,
  });
  if (!result) throw new AssistantToolAccessError('The assigned register is not active at this POS location.');
  return {
    ...result,
    scope: 'Shared server records for the verified POS location and register. Browser-local parked carts and offline queues are not included.',
  };
}

async function lookupPosRecentTransactions(principal: PosAssistantPrincipal, args: Record<string, unknown>) {
  const registerId = requirePosRegister(principal);
  const days = Math.min(30, Math.max(1, Math.round(asNumber(args.days) || 7)));
  const result = await loadPosRecentTransactions({
    businessId: principal.businessId,
    locationId: principal.locationId,
    registerId,
    days,
    limit: 20,
  });
  if (!result) throw new AssistantToolAccessError('The assigned register is not active at this POS location.');
  return {
    ...result,
    scope: 'Completed shared server transactions assigned directly or by register session to the verified register. Customer, cashier, notes, payment references, parked carts, and offline queues are omitted.',
  };
}

async function lookupWholesaleCatalogue(principal: WholesaleAssistantPrincipal, searchValue: unknown) {
  if (principal.brandAccess.mode === 'none') return [];
  const search = boundedSearch(searchValue);
  if (search.length < 2) throw new AssistantToolValidationError('Catalogue search must contain at least two characters.');
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
  if (!reference) throw new AssistantToolValidationError('Order reference is required.');
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
  const toolName = name as AssistantToolName;
  if (!assistantToolDefinitions.some(tool => tool.name === toolName)
    || !hasAssistantToolPrincipalAccess(principal, toolName)) {
    throw new AssistantToolAccessError('Assistant tool is not available for this audience.');
  }
  switch (toolName) {
    case 'ims_product_lookup': return lookupImsProduct(principal as ImsAssistantPrincipal, args.search);
    case 'ims_order_summary': return lookupImsOrder(principal as ImsAssistantPrincipal, args);
    case 'ims_order_search': return searchImsOrders(principal as ImsAssistantPrincipal, args);
    case 'ims_stock_alerts': return lookupImsStockAlerts(principal as ImsAssistantPrincipal, args);
    case 'ims_inventory_position': return lookupImsInventoryPosition(principal as ImsAssistantPrincipal, args);
    case 'ims_stock_movement_history': return lookupImsStockMovementHistory(principal as ImsAssistantPrincipal, args);
    case 'ims_stock_allocation_exceptions': return lookupImsStockAllocationExceptions(principal as ImsAssistantPrincipal, args);
    case 'ims_customer_lookup': return lookupImsCustomer(principal as ImsAssistantPrincipal, args.search);
    case 'ims_customer_activity': return lookupImsCustomerActivity(principal as ImsAssistantPrincipal, args);
    case 'ims_sales_performance': return lookupImsSalesPerformance(principal as ImsAssistantPrincipal, args);
    case 'ims_reorder_forecast': return lookupImsReorderForecast(principal as ImsAssistantPrincipal, args);
    case 'ims_purchase_order_aging': return lookupImsPurchaseOrderAging(principal as ImsAssistantPrincipal, args);
    case 'ims_xero_sync_diagnostics': return lookupImsXeroDiagnostics(principal as ImsAssistantPrincipal, args);
    case 'ims_shopify_sync_diagnostics': return lookupImsShopifyDiagnostics(principal as ImsAssistantPrincipal);
    case 'ims_marketing_performance': return lookupImsMarketingPerformance(principal as ImsAssistantPrincipal, args);
    case 'ims_marketing_recommendations': return lookupImsMarketingRecommendations(principal as ImsAssistantPrincipal, args);
    case 'pos_product_lookup': return lookupPosProduct(principal as PosAssistantPrincipal, args.search);
    case 'pos_session_context': {
      const pos = principal as PosAssistantPrincipal;
      return { location: pos.locationName, locationId: pos.locationId, register: pos.registerName, registerId: pos.registerId, tier: pos.tier };
    }
    case 'pos_register_status': return lookupPosRegisterStatus(principal as PosAssistantPrincipal);
    case 'pos_recent_transactions': return lookupPosRecentTransactions(principal as PosAssistantPrincipal, args);
    case 'wholesale_catalogue_lookup': return lookupWholesaleCatalogue(principal as WholesaleAssistantPrincipal, args.search);
    case 'wholesale_order_summary': return lookupWholesaleOrder(principal as WholesaleAssistantPrincipal, args.reference);
    case 'wholesale_account_summary': return wholesaleAccountSummary(principal as WholesaleAssistantPrincipal);
    default: throw new AssistantToolAccessError('Unknown assistant tool.');
  }
}