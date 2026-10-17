import { createHash } from 'node:crypto';
import { onlineSyncTimestamp, OnlineSyncValidationError } from './onlineSyncPolicy';
import { parseShopifyOrderDeliveryAddress, parseShopifyOrderDeliveryMethod } from '@/lib/ims/shopifyOrderAddress';
import { toBusinessDate } from '@/lib/shopifyDate';

export interface ShopifyOrderIdentity {
  businessId: string;
  channelInstanceId: string;
  externalOrderId: string;
}

export interface ShopifyOrderSnapshot extends ShopifyOrderIdentity {
  updatedAt: string;
  hash: string;
}

export function validateShopifyOrderIdentity(identity: ShopifyOrderIdentity): void {
  if (!identity.businessId.trim() || identity.businessId.length > 100
    || !identity.channelInstanceId.trim() || identity.channelInstanceId.length > 36
    || !/^[1-9]\d{0,99}$/.test(identity.externalOrderId)) {
    throw new OnlineSyncValidationError('An exact Shopify order owner is required.');
  }
}

export function validateShopifyOrderSnapshot(snapshot: ShopifyOrderSnapshot): void {
  validateShopifyOrderIdentity(snapshot);
  onlineSyncTimestamp(snapshot.updatedAt);
  if (!/^[a-f0-9]{64}$/.test(snapshot.hash)) {
    throw new OnlineSyncValidationError('Invalid Shopify order fingerprint.');
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OnlineSyncValidationError('Invalid Shopify order snapshot object.');
  }
  return value as Record<string, unknown>;
}

function pick(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}

function canonical(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  const object = record(value);
  return Object.fromEntries(Object.keys(object).sort().map(key => [key, canonical(object[key])]));
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isSafeInteger(value))) {
    throw new OnlineSyncValidationError('Invalid Shopify snapshot identity.');
  }
  const id = String(value);
  if (!/^[1-9]\d{0,99}$/.test(id)) throw new OnlineSyncValidationError('Invalid Shopify snapshot identity.');
  return id;
}

function entities(value: unknown, fields: readonly string[]): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new OnlineSyncValidationError('A complete Shopify order snapshot is required.');
  const ids = new Set<string>();
  return value.map(raw => {
    const entity = record(raw);
    const id = identifier(entity.id);
    if (ids.has(id)) throw new OnlineSyncValidationError('Duplicate Shopify snapshot entity.');
    ids.add(id);
    return { ...pick(entity, fields), id };
  });
}

// Only full reconciliation responses qualify; partial events must not advance this version fence.
export function shopifyOrderSnapshot(input: {
  businessId: string;
  channelInstanceId: string;
  order: Record<string, unknown>;
}): ShopifyOrderSnapshot {
  const order = input.order;
  const externalOrderId = identifier(order.id);
  const identity = { businessId: input.businessId, channelInstanceId: input.channelInstanceId, externalOrderId };
  validateShopifyOrderIdentity(identity);
  if (typeof order.updated_at !== 'string' || typeof order.created_at !== 'string'
    || typeof order.financial_status !== 'string' || typeof order.currency !== 'string'
    || !('cancelled_at' in order) || !('fulfillment_status' in order)) {
    throw new OnlineSyncValidationError('A complete Shopify order snapshot is required.');
  }
  const updatedAt = new Date(onlineSyncTimestamp(order.updated_at)).toISOString();
  const createdAt = new Date(onlineSyncTimestamp(order.created_at)).toISOString();
  if (onlineSyncTimestamp(updatedAt) < onlineSyncTimestamp(createdAt)) {
    throw new OnlineSyncValidationError('Shopify update version precedes order creation.');
  }
  for (const key of ['processed_at', 'cancelled_at']) {
    if (order[key] != null) {
      if (typeof order[key] !== 'string') throw new OnlineSyncValidationError('Invalid Shopify order lifecycle timestamp.');
      onlineSyncTimestamp(order[key]);
    }
  }
  const paidAt = typeof order.processed_at === 'string' ? order.processed_at : updatedAt;
  const money: Record<string, number> = {};
  for (const key of ['subtotal_price', 'total_tax', 'total_price', 'total_discounts']) {
    const value = order[key];
    if ((typeof value !== 'string' && typeof value !== 'number')
      || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
      throw new OnlineSyncValidationError('Invalid Shopify order snapshot amount.');
    }
    money[key] = Number(value);
  }
  const lineItems = entities(order.line_items, [
    'variant_id', 'product_id', 'quantity', 'current_quantity', 'price', 'name', 'title', 'sku',
    'gift_card', 'total_discount', 'discount_allocations', 'variant_inventory_management',
  ]);
  const refunds = entities(order.refunds, [
    'order_id', 'created_at', 'processed_at', 'transactions', 'refund_line_items', 'order_adjustments', 'return',
  ]);
  const fulfilments = entities(order.fulfillments, [
    'order_id', 'status', 'created_at', 'updated_at', 'line_items',
    'tracking_company', 'tracking_number', 'tracking_numbers', 'tracking_url', 'tracking_urls',
  ]);
  const customer = order.customer == null ? null : record(order.customer);
  const projection = {
    version: 1, ...identity, createdAt, paidDate: toBusinessDate(paidAt), ...money,
    ...pick(order, [
      'name', 'currency', 'financial_status', 'fulfillment_status', 'cancelled_at', 'cancel_reason',
      'processed_at', 'payment_gateway_names', 'gateway', 'total_shipping_price_set', 'discount_codes',
    ]),
    customerId: customer?.id == null ? null : identifier(customer.id),
    delivery: parseShopifyOrderDeliveryAddress(order),
    deliveryMethod: parseShopifyOrderDeliveryMethod(order),
    lineItems, refunds, fulfilments,
  };
  return {
    ...identity, updatedAt,
    hash: createHash('sha256').update(JSON.stringify(canonical(projection))).digest('hex'),
  };
}
