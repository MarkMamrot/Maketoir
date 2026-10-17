import type { Pool } from 'mysql2/promise';
import { OnlineSyncValidationError } from './onlineSyncPolicy';
import { runShopifyOrderEffect, type ShopifyOrderLease } from './shopifyOrderCoordination';
import { applyShopifyOrderRefundInTransaction, type ShopifyOrderRefundInput } from './shopifyOrderRefund';
import { applyShopifyOrderFulfilmentInTransaction, type ShopifyOrderFulfilmentInput } from './shopifyOrderFulfilment';

function sourceId(value: unknown): string {
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isSafeInteger(value))) {
    throw new OnlineSyncValidationError('Invalid coordinated Shopify effect identity.');
  }
  const id = String(value);
  if (!/^[1-9]\d{0,99}$/.test(id)) throw new OnlineSyncValidationError('Invalid coordinated Shopify effect identity.');
  return id;
}

function assertOrder(lease: ShopifyOrderLease, value: unknown): void {
  if (sourceId(value) !== lease.externalOrderId) {
    throw new OnlineSyncValidationError('Shopify effect does not belong to the claimed order.');
  }
}

export async function applyCoordinatedShopifyRefund(
  lease: ShopifyOrderLease,
  refund: ShopifyOrderRefundInput['refund'],
  pool?: Pick<Pool, 'getConnection'>,
) {
  assertOrder(lease, refund.order_id);
  const refundId = sourceId(refund.id);
  return runShopifyOrderEffect(lease, `refund:${refundId}`, async connection => {
    const result = await applyShopifyOrderRefundInTransaction(connection, {
      businessId: lease.businessId, channelInstanceId: lease.channelInstanceId, refund,
    });
    if (!result.creditNoteId) throw new Error('Coordinated Shopify refund has no completed credit note.');
    return { status: 'applied', referenceId: String(result.creditNoteId) };
  }, pool);
}

export async function applyCoordinatedShopifyFulfilment(
  lease: ShopifyOrderLease,
  input: Pick<ShopifyOrderFulfilmentInput, 'topic' | 'payload'>,
  pool?: Pick<Pool, 'getConnection'>,
) {
  const isShipment = input.topic.startsWith('fulfillments/');
  assertOrder(lease, isShipment ? input.payload.order_id : input.payload.id);
  const key = isShipment
    ? `${input.topic === 'fulfillments/update' ? 'shipment' : 'fulfilment'}:${sourceId(input.payload.id)}`
    : 'order_fulfilment';
  return runShopifyOrderEffect(lease, key, async connection => {
    const result = await applyShopifyOrderFulfilmentInTransaction(connection, {
      businessId: lease.businessId, channelInstanceId: lease.channelInstanceId,
      topic: input.topic, payload: input.payload,
    });
    return { status: 'applied', referenceId: String(result.salesOrderId) };
  }, pool);
}
