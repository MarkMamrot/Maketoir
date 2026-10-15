import { createHash, randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2/promise';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { AusPostEparcelClient } from '@/lib/ims/shipping/carriers/auspostEparcel/client';
import { AusPostTrackingError, type AusPostArticleTracking } from '@/lib/ims/shipping/carriers/auspostEparcel/tracking';
import { ShippingSettingsRepository } from '@/lib/ims/shipping/shippingSettingsRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool, imsQuery } from '@/services/IMSMySQLService';
import { ACTIVE_DELIVERY_EVIDENCE_SQL, saveCarrierDeliveryEvidence } from './amazonDeliveryEvidenceRepository';

interface PollParcel {
  id: number; so_id: number; shipment_id: number; carrier_account_id: number; article_id: string;
}
export interface DeliveryPollTotals { attempted: number; delivered: number; pending: number; failed: number; deferred: number }

export async function pollAmazonDeliveryEvidence(
  businessId: string, requestTimes = new Map<string, number>(), deadline = Date.now() + 240_000,
): Promise<DeliveryPollTotals> {
  return runImsForBusiness(businessId, async () => {
    const totals: DeliveryPollTotals = { attempted: 0, delivered: 0, pending: 0, failed: 0, deferred: 0 };
    const candidates = await imsQuery<PollParcel>(
      `SELECT p.id, s.so_id, s.id AS shipment_id, s.carrier_account_id, p.article_id
        FROM ims_shipping_parcels p
        JOIN ims_shipping_shipments s ON s.id = p.shipment_id AND s.business_id = p.business_id
        JOIN ims_sales_orders o ON o.id = s.so_id AND o.business_id = s.business_id
        LEFT JOIN ims_amazon_delivery_poll_state state ON state.parcel_id = p.id AND state.business_id = p.business_id
        WHERE p.business_id = ? AND o.sales_channel = 'amazon' AND s.provider = 'auspost_eparcel'
          AND s.ims_fulfilled_at IS NOT NULL AND s.voided_at IS NULL AND s.carrier_account_id IS NOT NULL
          AND p.article_id REGEXP '^[A-Za-z0-9]{1,100}$'
          AND (state.next_check_at IS NULL OR state.next_check_at <= UTC_TIMESTAMP(3))
          AND (state.locked_until IS NULL OR state.locked_until <= UTC_TIMESTAMP(3))
          AND NOT EXISTS (SELECT 1 FROM ims_amazon_delivery_evidence d
            WHERE d.business_id = p.business_id AND d.so_id = o.id AND d.parcel_id = p.id AND ${ACTIVE_DELIVERY_EVIDENCE_SQL})
        ORDER BY COALESCE(state.next_check_at, '2000-01-01'), p.id LIMIT 20`, [businessId]);
    const groups = new Map<number, PollParcel[]>();
    for (const candidate of candidates) {
      const accountId = Number(candidate.carrier_account_id);
      groups.set(accountId, [...(groups.get(accountId) ?? []), candidate]);
    }
    for (const [accountId, parcels] of groups) {
      if (Date.now() >= deadline) { totals.deferred += parcels.length; continue; }
      const token = randomUUID();
      const claimed: PollParcel[] = [];
      for (const parcel of parcels) {
        const connection = await getIMSPool().getConnection();
        try {
          await connection.execute(
            `INSERT INTO ims_amazon_delivery_poll_state (business_id, parcel_id) VALUES (?, ?)
              ON DUPLICATE KEY UPDATE parcel_id = VALUES(parcel_id)`, [businessId, parcel.id]);
          const [result] = await connection.execute<ResultSetHeader>(
            `UPDATE ims_amazon_delivery_poll_state SET locked_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE), claim_token = ?
              WHERE business_id = ? AND parcel_id = ?
                AND (locked_until IS NULL OR locked_until <= UTC_TIMESTAMP(3))
                AND (next_check_at IS NULL OR next_check_at <= UTC_TIMESTAMP(3))`, [token, businessId, parcel.id]);
          if (result.affectedRows === 1) claimed.push(parcel);
          else totals.deferred++;
        } finally { connection.release(); }
      }
      if (!claimed.length) continue;
      let tracked: AusPostArticleTracking[];
      try {
        totals.attempted += claimed.length;
        const credentials = await ShippingSettingsRepository.getAccountCredentials(businessId, accountId);
        if (!credentials || credentials.provider !== 'auspost_eparcel') throw new AusPostTrackingError('carrier_credentials_unavailable');
        const credentialKey = createHash('sha256').update(credentials.apiKey).digest('hex');
        // Track Items permits ten requests per minute. Share the spacing across all businesses in this run.
        const delay = Math.max(0, (requestTimes.get(credentialKey) ?? 0) + 6_500 - Date.now());
        if (Date.now() + delay + 30_000 >= deadline) {
          await releaseClaims(businessId, claimed, token);
          totals.attempted -= claimed.length;
          totals.deferred += claimed.length;
          continue;
        }
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        requestTimes.set(credentialKey, Date.now());
        tracked = await new AusPostEparcelClient(credentials).trackArticles(claimed.map(parcel => parcel.article_id));
      } catch (error) {
        const code = error instanceof AusPostTrackingError ? error.code : 'tracking_request_failed';
        for (const parcel of claimed) {
          await finishPoll(businessId, parcel.id, token, 'error', code);
          totals.failed++;
        }
        await reportRuntimeIssue({
          businessId, source: 'amazon.delivery-tracking', operation: 'track_articles', title: 'Amazon carrier delivery tracking failed',
          error, context: { carrierAccountId: accountId, parcelIds: claimed.map(parcel => Number(parcel.id)), errorCode: code },
        });
        continue;
      }
      for (const parcel of claimed) {
        const result = tracked.find(result => result.articleId === parcel.article_id);
        try {
          if (!result) throw new AusPostTrackingError('article_identity_mismatch');
          if (result.outcome === 'error') throw new AusPostTrackingError(result.errorCode ?? 'carrier_article_error');
          if (result.outcome === 'delivered') {
            if (!result.deliveredAt) throw new AusPostTrackingError('delivery_timestamp_unverified');
            await saveCarrierDeliveryEvidence({
              businessId, salesOrderId: Number(parcel.so_id), parcelId: Number(parcel.id),
              articleId: parcel.article_id, deliveredAt: result.deliveredAt,
            });
          }
          await finishPoll(businessId, parcel.id, token, result.outcome, null);
          if (result.outcome === 'delivered') totals.delivered++;
          else totals.pending++;
        } catch (error) {
          const code = error instanceof AusPostTrackingError ? error.code : 'evidence_save_failed';
          await finishPoll(businessId, parcel.id, token, 'error', code);
          totals.failed++;
          await reportRuntimeIssue({
            businessId, source: 'amazon.delivery-tracking', operation: 'verify_parcel_delivery',
            title: 'Amazon parcel delivery evidence needs attention', error,
            context: { salesOrderId: Number(parcel.so_id), parcelId: Number(parcel.id), errorCode: code },
            reference: { type: 'sales_order', id: Number(parcel.so_id) },
          });
        }
      }
    }
    return totals;
  });
}

async function releaseClaims(businessId: string, parcels: PollParcel[], token: string): Promise<void> {
  const connection = await getIMSPool().getConnection();
  try {
    for (const parcel of parcels) await connection.execute(
      `UPDATE ims_amazon_delivery_poll_state SET locked_until = NULL, claim_token = NULL
        WHERE business_id = ? AND parcel_id = ? AND claim_token = ?`, [businessId, parcel.id, token]);
  } finally { connection.release(); }
}

async function finishPoll(businessId: string, parcelId: number, token: string, outcome: 'pending' | 'delivered' | 'error', code: string | null): Promise<void> {
  const connection = await getIMSPool().getConnection();
  try {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE ims_amazon_delivery_poll_state SET last_checked_at = UTC_TIMESTAMP(3),
        next_check_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR), outcome = ?, safe_error_code = ?,
        locked_until = NULL, claim_token = NULL WHERE business_id = ? AND parcel_id = ? AND claim_token = ?`,
      [outcome === 'error' ? 1 : 6, outcome, code, businessId, parcelId, token]);
    if (result.affectedRows !== 1) throw new Error('The Amazon tracking lease changed before its outcome could be saved.');
  } finally { connection.release(); }
}
