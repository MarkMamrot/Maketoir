import { shopifyOrderSnapshot } from './shopifyOrderSnapshot';
import { OnlineSyncValidationError } from './onlineSyncPolicy';

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new OnlineSyncValidationError('Incomplete recovery order.');
  return value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new OnlineSyncValidationError('Invalid recovery lifecycle record.');
    }
    return row as Record<string, unknown>;
  });
}

export function planShopifyOrderRecovery(input: {
  businessId: string; channelInstanceId: string; order: Record<string, unknown>;
}) {
  const snapshot = shopifyOrderSnapshot(input);
  const fulfilments = records(input.order.fulfillments);
  const refunds = records(input.order.refunds);
  const cancelled = input.order.cancelled_at != null;
  const paid = ['paid', 'partially_refunded', 'refunded'].includes(String(input.order.financial_status));
  const stockFulfilments = fulfilments.filter(row => row.status === 'success');
  const keys = [
    'order_record',
    ...stockFulfilments.map(row => `fulfilment:${row.id}`),
    ...(input.order.fulfillment_status === 'fulfilled' ? ['order_fulfilment'] : []),
    ...refunds.map(row => `refund:${row.id}`),
    ...(cancelled ? ['cancellation'] : []),
    'downstream',
  ];
  if (keys.length > 1000) throw new OnlineSyncValidationError('Recovery order exceeds the bounded effect plan.');
  return { snapshot, keys, fulfilments: stockFulfilments, refunds, cancelled, paid };
}
