import { createHash } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getIMSPool } from '@/services/IMSMySQLService';
import { SALES_CHANNEL_PROVIDERS } from '@/lib/channels/types';
import {
  DeliveryEvidenceConflictError, DeliveryEvidenceValidationError, deliveryReviewDeadline, positiveDeliveryId,
  verifiedDeliveryTimestamp, validateDeliveryEvidenceReport, type AmazonDeliveryEvidenceReport, type ManualDeliveryRequest,
} from './amazonDeliveryEvidence';

export const ACTIVE_DELIVERY_EVIDENCE_SQL = `d.kind = 'delivery' AND d.delivered_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ims_amazon_delivery_evidence v
    WHERE v.business_id = d.business_id AND v.voids_evidence_id = d.id AND v.kind = 'void')`;
export const EARLIEST_DELIVERY_SQL = `(SELECT MIN(d.delivered_at) FROM ims_amazon_delivery_evidence d
  WHERE d.business_id = o.business_id AND d.so_id = o.id AND ${ACTIVE_DELIVERY_EVIDENCE_SQL})`;
export const DELIVERY_EVIDENCE_COLUMNS = ['id', 'business_id', 'so_id', 'parcel_id', 'kind', 'source', 'delivered_at',
  'basis', 'evidence_reference', 'actor_user_id', 'voids_evidence_id', 'operation_key', 'request_hash', 'recorded_at'];

interface OrderRow extends RowDataPacket { id: number; orderDate: string | null; earliest: string | null }
interface ParcelRow extends RowDataPacket {
  id: number; shipment_id: number; parcel_number: number; provider: string; article_id: string | null;
  lastCheckedAt: string | null; outcome: string | null;
}
interface EvidenceRow extends RowDataPacket {
  id: number; parcel_id: number | null; kind: 'delivery' | 'void'; source: 'manual' | 'auspost'; deliveredAt: string | null;
  basis: string; evidence_reference: string; actor_user_id: number | null; voids_evidence_id: number | null;
  recordedAt: string; active: number; request_hash: string;
}
interface ColumnRow extends RowDataPacket { COLUMN_NAME: string }

export class DeliveryEvidenceNotFoundError extends Error {}

async function rows<T extends RowDataPacket>(connection: PoolConnection, sql: string, params: Array<string | number | null>): Promise<T[]> {
  const [result] = await connection.execute<T[]>(sql, params);
  return result;
}
function iso(value: string | null): string | null {
  if (value === null) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('Stored delivery evidence has an invalid timestamp.');
  return new Date(time).toISOString();
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }

async function assertEvidenceStorage(connection: PoolConnection): Promise<void> {
  const columns = await rows<ColumnRow>(connection,
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ims_amazon_delivery_evidence'`, []);
  if (!DELIVERY_EVIDENCE_COLUMNS.every(column => columns.some(row => row.COLUMN_NAME === column))) {
    throw new Error('Amazon delivery evidence storage is not ready. Apply the tenant schema rollout before using this workflow.');
  }
}

export async function getAmazonDeliveryEvidence(businessId: string, salesOrderId: number): Promise<AmazonDeliveryEvidenceReport> {
  positiveDeliveryId(salesOrderId);
  if (!businessId) throw new DeliveryEvidenceValidationError('A business scope is required.');
  return runImsForBusiness(businessId, async () => {
    const connection = await getIMSPool().getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      await assertEvidenceStorage(connection);
      const [order] = await rows<OrderRow>(connection,
        `SELECT o.id, DATE_FORMAT(${EARLIEST_DELIVERY_SQL}, '%Y-%m-%dT%H:%i:%s.%fZ') AS earliest
          FROM ims_sales_orders o WHERE o.business_id = ? AND o.id = ? AND o.sales_channel = 'amazon'`, [businessId, salesOrderId]);
      if (!order) throw new DeliveryEvidenceNotFoundError('Amazon order not found in the active business.');
      const parcels = await rows<ParcelRow>(connection,
        `SELECT p.id, p.shipment_id, p.parcel_number, s.provider, p.article_id,
          DATE_FORMAT(state.last_checked_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS lastCheckedAt, state.outcome
          FROM ims_shipping_parcels p JOIN ims_shipping_shipments s ON s.id = p.shipment_id AND s.business_id = p.business_id
          LEFT JOIN ims_amazon_delivery_poll_state state ON state.parcel_id = p.id AND state.business_id = p.business_id
          WHERE s.business_id = ? AND s.so_id = ? AND s.ims_fulfilled_at IS NOT NULL AND s.voided_at IS NULL
          ORDER BY p.id LIMIT 101`, [businessId, salesOrderId]);
      if (parcels.length > 100) throw new Error('This order exceeds the delivery evidence parcel review limit.');
      const history = await rows<EvidenceRow>(connection,
        `SELECT d.id, d.parcel_id, d.kind, d.source, d.basis, d.evidence_reference, d.actor_user_id, d.voids_evidence_id,
          DATE_FORMAT(d.delivered_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS deliveredAt,
          DATE_FORMAT(d.recorded_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS recordedAt, (${ACTIVE_DELIVERY_EVIDENCE_SQL}) AS active
          FROM ims_amazon_delivery_evidence d WHERE d.business_id = ? AND d.so_id = ? ORDER BY d.id DESC LIMIT 51`, [businessId, salesOrderId]);
      const earliest = iso(order.earliest);
      const report: AmazonDeliveryEvidenceReport = {
        salesOrderId, earliestVerifiedDeliveryAt: earliest, reviewDeadlineAt: earliest ? deliveryReviewDeadline(earliest) : null,
        parcels: parcels.map(parcel => ({
          id: positiveDeliveryId(Number(parcel.id)), shipmentId: positiveDeliveryId(Number(parcel.shipment_id)),
          parcelNumber: positiveDeliveryId(Number(parcel.parcel_number)),
          automaticTracking: parcel.provider === 'auspost_eparcel' && /^[A-Za-z0-9]{1,100}$/.test(parcel.article_id ?? ''),
          lastCheckedAt: iso(parcel.lastCheckedAt), outcome: parcel.outcome,
        })),
        history: history.slice(0, 50).map(entry => ({
          id: positiveDeliveryId(Number(entry.id)), parcelId: entry.parcel_id === null ? null : positiveDeliveryId(Number(entry.parcel_id)),
          kind: entry.kind, source: entry.source, deliveredAt: iso(entry.deliveredAt), basis: entry.basis,
          reference: entry.evidence_reference, recordedAt: iso(entry.recordedAt)!,
          actorUserId: entry.actor_user_id === null ? null : positiveDeliveryId(Number(entry.actor_user_id)),
          voidsEvidenceId: entry.voids_evidence_id === null ? null : positiveDeliveryId(Number(entry.voids_evidence_id)), active: Number(entry.active) === 1,
        })), hasMoreHistory: history.length > 50,
      };
      await connection.commit();
      return validateDeliveryEvidenceReport(report);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  });
}

type EvidenceWrite = {
  businessId: string; salesOrderId: number; parcelId: number | null; source: 'auspost' | 'manual';
  actorUserId: number | null; kind: 'delivery' | 'void'; deliveredAt: string | null;
  basis: string; reference: string; operationKey: string; voidsEvidenceId: number | null;
  expectedArticleId?: string;
};

async function appendEvidence(input: EvidenceWrite): Promise<number> {
  if (!input.businessId) throw new DeliveryEvidenceValidationError('A business scope is required.');
  positiveDeliveryId(input.salesOrderId);
  const requestHash = hash(JSON.stringify(input));
  return runImsForBusiness(input.businessId, async () => {
    const connection = await getIMSPool().getConnection();
    try {
      await assertEvidenceStorage(connection);
      await connection.beginTransaction();
      const channels = input.source === 'manual' ? ['amazon'] : SALES_CHANNEL_PROVIDERS;
      const [order] = await rows<OrderRow>(connection,
        `SELECT id, DATE_FORMAT(order_date, '%Y-%m-%d') AS orderDate FROM ims_sales_orders
          WHERE business_id = ? AND id = ? AND sales_channel IN (${channels.map(() => '?').join(', ')}) FOR UPDATE`,
        [input.businessId, input.salesOrderId, ...channels]);
      if (!order) throw new DeliveryEvidenceNotFoundError(`${input.source === 'manual' ? 'Amazon' : 'Online-channel'} order not found in the active business.`);
      const [existing] = await rows<EvidenceRow>(connection,
        `SELECT id, request_hash FROM ims_amazon_delivery_evidence WHERE business_id = ? AND operation_key = ? FOR UPDATE`,
        [input.businessId, input.operationKey]);
      if (existing) {
        if (existing.request_hash !== requestHash) throw new DeliveryEvidenceConflictError('This verification operation was already used for different evidence.');
        await connection.commit();
        return positiveDeliveryId(Number(existing.id));
      }
      if (input.kind === 'delivery') {
        if (!input.deliveredAt) throw new DeliveryEvidenceValidationError('A verified delivery date is required.');
        verifiedDeliveryTimestamp(input.deliveredAt);
        // Order dates have no timezone. Allow a calendar-day offset, but reject grossly earlier evidence.
        if (order.orderDate && Date.parse(input.deliveredAt) < Date.parse(`${order.orderDate}T00:00:00Z`) - 86_400_000) {
          throw new DeliveryEvidenceValidationError('Delivery evidence predates the order.');
        }
        if (input.parcelId !== null) {
          const [parcel] = await rows<ParcelRow>(connection,
            `SELECT p.id, p.article_id, s.provider FROM ims_shipping_parcels p
              JOIN ims_shipping_shipments s ON s.id = p.shipment_id AND s.business_id = p.business_id
              WHERE p.business_id = ? AND p.id = ? AND s.so_id = ? AND s.ims_fulfilled_at IS NOT NULL AND s.voided_at IS NULL FOR UPDATE`,
            [input.businessId, input.parcelId, input.salesOrderId]);
          if (!parcel) throw new DeliveryEvidenceNotFoundError('Dispatched original-order parcel not found.');
          if (input.source === 'auspost') {
            const expectedArticle = input.expectedArticleId;
            if (!expectedArticle || parcel.provider !== 'auspost_eparcel' || parcel.article_id !== expectedArticle) {
              throw new DeliveryEvidenceConflictError('The original tracking article changed before its evidence could be saved.');
            }
            const duplicates = await rows<ParcelRow>(connection,
              `SELECT p.id FROM ims_shipping_parcels p
                JOIN ims_shipping_shipments s ON s.id = p.shipment_id AND s.business_id = p.business_id
                WHERE p.business_id = ? AND BINARY p.article_id = BINARY ? AND s.provider = 'auspost_eparcel'
                  AND s.ims_fulfilled_at IS NOT NULL AND s.voided_at IS NULL LIMIT 2`,
              [input.businessId, expectedArticle]);
            if (duplicates.length !== 1) throw new DeliveryEvidenceConflictError('This tracking article is assigned to more than one dispatched parcel.');
          }
        } else if (input.source !== 'manual') throw new DeliveryEvidenceValidationError('Carrier evidence must identify its original parcel.');
      } else {
        const [target] = await rows<EvidenceRow>(connection,
          `SELECT d.id, d.parcel_id, (${ACTIVE_DELIVERY_EVIDENCE_SQL}) AS active FROM ims_amazon_delivery_evidence d
            WHERE d.business_id = ? AND d.so_id = ? AND d.id = ? AND d.source = 'manual' AND d.kind = 'delivery' FOR UPDATE`,
          [input.businessId, input.salesOrderId, input.voidsEvidenceId]);
        if (!target) throw new DeliveryEvidenceNotFoundError('Manual evidence not found for this Amazon order.');
        if (Number(target.active) !== 1) throw new DeliveryEvidenceConflictError('This manual evidence has already been voided.');
        input = { ...input, parcelId: target.parcel_id === null ? null : Number(target.parcel_id) };
      }
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO ims_amazon_delivery_evidence
          (business_id, so_id, parcel_id, kind, source, delivered_at, basis, evidence_reference, actor_user_id,
           voids_evidence_id, operation_key, request_hash, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [input.businessId, input.salesOrderId, input.parcelId, input.kind, input.source,
          input.deliveredAt ? input.deliveredAt.replace('T', ' ').replace('Z', '') : null, input.basis, input.reference,
          input.actorUserId, input.voidsEvidenceId, input.operationKey, requestHash]);
      await connection.commit();
      return positiveDeliveryId(Number(result.insertId));
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  });
}

export async function saveManualDeliveryEvidence(businessId: string, actorUserId: number, request: ManualDeliveryRequest): Promise<number> {
  positiveDeliveryId(actorUserId);
  return appendEvidence({
    businessId, actorUserId, salesOrderId: request.salesOrderId, source: 'manual', operationKey: `manual:${request.operationKey}`,
    kind: request.action === 'record' ? 'delivery' : 'void', parcelId: request.action === 'record' ? request.parcelId : null,
    deliveredAt: request.action === 'record' ? request.deliveredAt : null,
    basis: request.action === 'record' ? request.basis : request.reason,
    reference: request.action === 'record' ? request.reference : `RECORD-${request.evidenceId}`,
    voidsEvidenceId: request.action === 'void' ? request.evidenceId : null,
  });
}

export async function saveCarrierDeliveryEvidence(input: {
  businessId: string; salesOrderId: number; parcelId: number; articleId: string; deliveredAt: string;
}): Promise<number> {
  positiveDeliveryId(input.parcelId);
  const deliveredAt = verifiedDeliveryTimestamp(input.deliveredAt);
  const articleHash = hash(input.articleId);
  return appendEvidence({
    ...input, expectedArticleId: input.articleId, deliveredAt, source: 'auspost', actorUserId: null, kind: 'delivery',
    basis: 'article-delivery', reference: `auspost-article:${articleHash}`, voidsEvidenceId: null,
    operationKey: `auspost:${input.parcelId}:${articleHash}:${deliveredAt}`,
  });
}
