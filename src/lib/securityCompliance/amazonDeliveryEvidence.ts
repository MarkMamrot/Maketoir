export const AMAZON_DELIVERY_REVIEW_DAYS = 30;
export const MANUAL_DELIVERY_BASES = ['carrier-portal', 'amazon-proof', 'recipient-confirmation'] as const;
export const DELIVERY_VOID_REASONS = ['wrong-order', 'wrong-date', 'not-verified'] as const;

export class DeliveryEvidenceValidationError extends Error {}
export class DeliveryEvidenceConflictError extends Error {}

export function positiveDeliveryId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new DeliveryEvidenceValidationError('Provide a positive numeric record ID.');
  }
  return value;
}

function normalizedDeliveryTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new DeliveryEvidenceValidationError('Provide a delivery timestamp with a timezone.');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || match[0] !== value) throw new DeliveryEvidenceValidationError('Provide a delivery timestamp with an explicit timezone.');
  const [, year, month, day, hour, minute, second, zone] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const offset = zone === 'Z' ? [0, 0] : zone.slice(1).split(':').map(Number);
  const time = Date.parse(value);
  if (Number(year) < 2000 || calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() + 1 !== Number(month)
    || calendar.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || offset[0] > 14 || offset[1] > 59 || (offset[0] === 14 && offset[1] !== 0)
    || !Number.isFinite(time)) {
    throw new DeliveryEvidenceValidationError('Delivery must be a valid timestamp.');
  }
  return new Date(time).toISOString();
}

export function verifiedDeliveryTimestamp(value: unknown, now = new Date()): string {
  const timestamp = normalizedDeliveryTimestamp(value);
  if (!Number.isFinite(now.getTime()) || Date.parse(timestamp) > now.getTime()) {
    throw new DeliveryEvidenceValidationError('Delivery must be a valid, non-future timestamp.');
  }
  return timestamp;
}

export function deliveryReviewDeadline(deliveredAt: string): string {
  return new Date(Date.parse(normalizedDeliveryTimestamp(deliveredAt)) + AMAZON_DELIVERY_REVIEW_DAYS * 86_400_000).toISOString();
}

export function deliveryReviewIsDue(deliveredAt: string, now = new Date()): boolean {
  if (!Number.isFinite(now.getTime())) throw new DeliveryEvidenceValidationError('Provide a valid review timestamp.');
  return Date.parse(deliveryReviewDeadline(deliveredAt)) <= now.getTime();
}

export type ManualDeliveryRequest = {
  action: 'record'; salesOrderId: number; parcelId: number | null; deliveredAt: string;
  basis: typeof MANUAL_DELIVERY_BASES[number]; reference: string; operationKey: string;
} | {
  action: 'void'; salesOrderId: number; evidenceId: number;
  reason: typeof DELIVERY_VOID_REASONS[number]; operationKey: string;
};

export function validateManualDeliveryRequest(value: unknown, now = new Date()): ManualDeliveryRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DeliveryEvidenceValidationError('Provide a delivery evidence request.');
  const body = value as Record<string, unknown>;
  const keys = body.action === 'record'
    ? ['action', 'salesOrderId', 'parcelId', 'deliveredAt', 'basis', 'reference', 'operationKey', 'verified']
    : ['action', 'salesOrderId', 'evidenceId', 'reason', 'operationKey'];
  if (Object.keys(body).some(key => !keys.includes(key))
    || typeof body.operationKey !== 'string' || body.operationKey.length !== 36
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.operationKey)) {
    throw new DeliveryEvidenceValidationError('Provide a unique verification operation; do not supply business or actor overrides.');
  }
  const salesOrderId = positiveDeliveryId(body.salesOrderId);
  const operationKey = body.operationKey.toLowerCase();
  if (body.action === 'void') {
    const reason = DELIVERY_VOID_REASONS.find(reason => reason === body.reason);
    if (!reason) throw new DeliveryEvidenceValidationError('Select a reason for voiding incorrect manual evidence.');
    return { action: 'void', salesOrderId, evidenceId: positiveDeliveryId(body.evidenceId), reason, operationKey };
  }
  const basis = MANUAL_DELIVERY_BASES.find(basis => basis === body.basis);
  if (body.action !== 'record' || !basis || body.verified !== true || typeof body.reference !== 'string' || body.reference.trim() !== body.reference
    || !/^(TICKET|CARRIER|AMAZON|RECORD)-[A-Z0-9-]{3,100}$/.test(body.reference)) {
    throw new DeliveryEvidenceValidationError('Confirm original buyer delivery and provide a non-personal evidence code such as TICKET-123.');
  }
  return { action: 'record', salesOrderId, operationKey, basis, reference: body.reference,
    parcelId: body.parcelId === null ? null : positiveDeliveryId(body.parcelId),
    deliveredAt: verifiedDeliveryTimestamp(body.deliveredAt, now) };
}

export interface DeliveryEvidenceEntry {
  id: number; parcelId: number | null; kind: 'delivery' | 'void'; source: 'auspost' | 'manual';
  deliveredAt: string | null; basis: string; reference: string; recordedAt: string;
  actorUserId: number | null; voidsEvidenceId: number | null; active: boolean;
}

export interface AmazonDeliveryEvidenceReport {
  salesOrderId: number; earliestVerifiedDeliveryAt: string | null; reviewDeadlineAt: string | null;
  parcels: Array<{ id: number; shipmentId: number; parcelNumber: number; automaticTracking: boolean; lastCheckedAt: string | null; outcome: string | null }>;
  history: DeliveryEvidenceEntry[]; hasMoreHistory: boolean;
}

export function validateDeliveryEvidenceReport(value: unknown): AmazonDeliveryEvidenceReport {
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid delivery evidence response.');
    return value as Record<string, unknown>;
  };
  const stamp = (value: unknown): string | null => {
    if (value === null) return null;
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
      throw new Error('Invalid delivery evidence timestamp.');
    }
    return value;
  };
  const body = object(value);
  const earliest = stamp(body.earliestVerifiedDeliveryAt);
  const deadline = stamp(body.reviewDeadlineAt);
  if (deadline !== (earliest ? deliveryReviewDeadline(earliest) : null)
    || !Array.isArray(body.parcels) || body.parcels.length > 100
    || !Array.isArray(body.history) || body.history.length > 50 || typeof body.hasMoreHistory !== 'boolean') {
    throw new Error('Invalid delivery evidence coverage.');
  }
  return {
    salesOrderId: positiveDeliveryId(body.salesOrderId), earliestVerifiedDeliveryAt: earliest, reviewDeadlineAt: deadline,
    parcels: body.parcels.map(value => {
      const parcel = object(value);
      if (typeof parcel.automaticTracking !== 'boolean' || ![null, 'pending', 'delivered', 'error'].includes(parcel.outcome as string | null)) {
        throw new Error('Invalid delivery tracking outcome.');
      }
      return {
        id: positiveDeliveryId(parcel.id), shipmentId: positiveDeliveryId(parcel.shipmentId), parcelNumber: positiveDeliveryId(parcel.parcelNumber),
        automaticTracking: parcel.automaticTracking, lastCheckedAt: stamp(parcel.lastCheckedAt), outcome: parcel.outcome as string | null,
      };
    }),
    history: body.history.map(value => {
      const entry = object(value);
      const kind = entry.kind === 'delivery' ? 'delivery' : entry.kind === 'void' ? 'void' : null;
      const source = entry.source === 'auspost' ? 'auspost' : entry.source === 'manual' ? 'manual' : null;
      const deliveredAt = stamp(entry.deliveredAt);
      const recordedAt = stamp(entry.recordedAt);
      if (!kind || !source || typeof entry.active !== 'boolean' || !recordedAt
        || typeof entry.reference !== 'string' || entry.reference.trim() !== entry.reference || typeof entry.basis !== 'string'
        || (source === 'auspost' && (kind !== 'delivery' || entry.parcelId === null || entry.actorUserId !== null || entry.basis !== 'article-delivery'
          || !/^auspost-article:[a-f0-9]{64}$/.test(entry.reference)))
        || (source === 'manual' && (entry.actorUserId === null || !/^(TICKET|CARRIER|AMAZON|RECORD)-[A-Z0-9-]{1,100}$/.test(entry.reference)
          || !(kind === 'delivery' ? MANUAL_DELIVERY_BASES : DELIVERY_VOID_REASONS).some(basis => basis === entry.basis)))
        || (kind === 'delivery' ? deliveredAt === null || entry.voidsEvidenceId !== null : deliveredAt !== null || entry.active || entry.voidsEvidenceId === null)) {
        throw new Error('Invalid delivery evidence history.');
      }
      return {
        id: positiveDeliveryId(entry.id), parcelId: entry.parcelId === null ? null : positiveDeliveryId(entry.parcelId),
        kind, source, deliveredAt, basis: entry.basis, reference: entry.reference, recordedAt, active: entry.active,
        actorUserId: entry.actorUserId === null ? null : positiveDeliveryId(entry.actorUserId),
        voidsEvidenceId: entry.voidsEvidenceId === null ? null : positiveDeliveryId(entry.voidsEvidenceId),
      };
    }), hasMoreHistory: body.hasMoreHistory,
  };
}
