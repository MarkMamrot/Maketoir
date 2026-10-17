import { OnlineSyncValidationError, onlineSyncTimestamp } from './onlineSyncPolicy';
import { parseShopifyGiftCardRecoveryContinuation } from './shopifyGiftCardRecoveryCheckpoint';

export type OnlineSyncWorkPayload = (
  | { kind: 'order_snapshot'; orderId: string }
  | { kind: 'order_effects'; orderId: string; updatedAt: string; hash: string; refundIds: string[]; paid: boolean }
  | { kind: 'daily_accounting'; date: string; manual?: true }
  | { kind: 'gift_cards'; continuation: import('./shopifyGiftCardRecoveryEffects').ShopifyGiftCardRecoveryContinuation | null }
) & { blockedReason?: string };

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,99}$/.test(value)) {
    throw new OnlineSyncValidationError('Invalid online recovery source identity.');
  }
  return value;
}

export function parseOnlineSyncWorkPayload(value: unknown): OnlineSyncWorkPayload {
  const parsed = parseWorkPayload(value);
  const blockedReason = (value as Record<string, unknown>).blockedReason;
  if (blockedReason === undefined) return parsed;
  if (typeof blockedReason !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(blockedReason)) {
    throw new OnlineSyncValidationError('Invalid recovery blocking reason.');
  }
  return { ...parsed, blockedReason };
}

function parseWorkPayload(value: unknown): OnlineSyncWorkPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OnlineSyncValidationError('Invalid online recovery job payload.');
  }
  const record = value as Record<string, unknown>;
  switch (record.kind) {
    case 'order_snapshot':
      return { kind: record.kind, orderId: id(record.orderId) };
    case 'order_effects': {
      if (typeof record.updatedAt !== 'string' || typeof record.hash !== 'string'
        || !/^[a-f0-9]{64}$/.test(record.hash) || typeof record.paid !== 'boolean'
        || !Array.isArray(record.refundIds) || record.refundIds.length > 1000) {
        throw new OnlineSyncValidationError('Invalid online recovery effect descriptor.');
      }
      onlineSyncTimestamp(record.updatedAt);
      const refundIds = record.refundIds.map(id);
      if (new Set(refundIds).size !== refundIds.length) throw new OnlineSyncValidationError('Duplicate recovery refund identity.');
      return {
        kind: record.kind, orderId: id(record.orderId), updatedAt: record.updatedAt,
        hash: record.hash, refundIds, paid: record.paid,
      };
    }
    case 'daily_accounting': {
      if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
        throw new OnlineSyncValidationError('Invalid recovery accounting date.');
      }
      onlineSyncTimestamp(`${record.date}T00:00:00.000Z`);
      if (record.manual !== undefined && record.manual !== true) {
        throw new OnlineSyncValidationError('Invalid manual accounting request.');
      }
      return { kind: record.kind, date: record.date, ...(record.manual === true ? { manual: true } : {}) };
    }
    case 'gift_cards': {
      return { kind: record.kind, continuation: record.continuation === null ? null
        : parseShopifyGiftCardRecoveryContinuation(record.continuation) };
    }
    default:
      throw new OnlineSyncValidationError('Unsupported online recovery job payload.');
  }
}
