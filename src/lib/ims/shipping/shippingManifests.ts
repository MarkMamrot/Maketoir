import { createHash } from 'node:crypto';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool, imsQuery } from '@/services/IMSMySQLService';

import { AusPostApiError, AusPostEparcelClient } from './carriers/auspostEparcel/client';
import { ShippingSettingsRepository } from './shippingSettingsRepository';
import { type ManifestCandidate, validateManifestCandidates } from './shippingWorkflow';

type ManifestShipmentRow = ManifestCandidate & {
  soNumber: string;
  channelOrderNumber: string | null;
  carrierName: string;
  dispatchLocationName: string | null;
  chargedCost: number | null;
};

export type ShippingManifestSummary = {
  id: number;
  provider: string;
  providerReference: string;
  providerOrderId: string | null;
  status: string;
  carrierAccountId: number;
  carrierName: string;
  dispatchLocationId: number | null;
  dispatchLocationName: string | null;
  shipmentCount: number;
  parcelCount: number;
  safeError: string | null;
  createdAt: string | Date;
  completedAt: string | Date | null;
};

export async function listShippingManifestWorkspace(businessId: string): Promise<{
  candidates: ManifestShipmentRow[];
  manifests: ShippingManifestSummary[];
}> {
  const candidates = await imsQuery<any>(
    `SELECT shipment.id AS shipmentId, shipment.carrier_account_id AS carrierAccountId,
            shipment.dispatch_location_id AS dispatchLocationId, shipment.provider,
            shipment.provider_shipment_id AS providerShipmentId, shipment.status AS shipmentStatus,
            shipment.ims_fulfilled_at AS imsFulfilledAt, shipment.manifest_id AS manifestId,
            sales_order.so_number AS soNumber,
            COALESCE(NULLIF(sales_order.shopify_order_name, ''), NULLIF(sales_order.native_checkout_id, '')) AS channelOrderNumber,
            account.display_name AS carrierName, location.name AS dispatchLocationName,
            shipment.charged_cost AS chargedCost,
            (SELECT latest.status FROM ims_shipping_labels latest
              WHERE latest.business_id = shipment.business_id AND latest.shipment_id = shipment.id
              ORDER BY latest.id DESC LIMIT 1) AS labelStatus,
            (SELECT COUNT(*) FROM ims_shipping_parcels parcel
              WHERE parcel.business_id = shipment.business_id AND parcel.shipment_id = shipment.id) AS parcelCount
       FROM ims_shipping_shipments shipment
       JOIN ims_sales_orders sales_order ON sales_order.id = shipment.so_id AND sales_order.business_id = shipment.business_id
       JOIN ims_shipping_carrier_accounts account ON account.id = shipment.carrier_account_id AND account.business_id = shipment.business_id
       LEFT JOIN ims_locations location ON location.id = shipment.dispatch_location_id AND location.business_id = shipment.business_id
      WHERE shipment.business_id = ? AND shipment.manifest_id IS NULL
        AND shipment.provider_shipment_id IS NOT NULL AND shipment.ims_fulfilled_at IS NOT NULL
      ORDER BY account.display_name, location.name, shipment.completed_at, shipment.id`,
    [businessId],
  );
  const manifests = await imsQuery<any>(
    `SELECT manifest.id, manifest.provider, manifest.provider_reference AS providerReference,
            manifest.provider_order_id AS providerOrderId, manifest.status,
            manifest.carrier_account_id AS carrierAccountId, account.display_name AS carrierName,
            manifest.dispatch_location_id AS dispatchLocationId, location.name AS dispatchLocationName,
            manifest.shipment_count AS shipmentCount, manifest.parcel_count AS parcelCount,
            manifest.safe_error AS safeError, manifest.created_at AS createdAt, manifest.completed_at AS completedAt
       FROM ims_shipping_manifests manifest
       JOIN ims_shipping_carrier_accounts account ON account.id = manifest.carrier_account_id AND account.business_id = manifest.business_id
       LEFT JOIN ims_locations location ON location.id = manifest.dispatch_location_id AND location.business_id = manifest.business_id
      WHERE manifest.business_id = ?
      ORDER BY manifest.created_at DESC, manifest.id DESC LIMIT 100`,
    [businessId],
  );
  return {
    candidates: candidates.map(normalizeCandidateRow),
    manifests: manifests.map(row => ({
      ...row,
      id: Number(row.id), carrierAccountId: Number(row.carrierAccountId),
      dispatchLocationId: row.dispatchLocationId == null ? null : Number(row.dispatchLocationId),
      shipmentCount: Number(row.shipmentCount), parcelCount: Number(row.parcelCount),
    })),
  };
}

export async function createShippingManifest(input: {
  businessId: string;
  operationKey: string;
  shipmentIds: number[];
}): Promise<ShippingManifestSummary> {
  const operationKey = input.operationKey.trim();
  const shipmentIds = normalizedIds(input.shipmentIds);
  if (!operationKey || operationKey.length > 150) throw new Error('A valid operation key is required.');
  if (!shipmentIds.length) throw new Error('Choose at least one dispatched shipment.');
  const requestHash = manifestRequestHash(shipmentIds);
  const providerReference = `SOL-${operationKey.replace(/[^A-Za-z0-9-]/g, '').slice(0, 46)}`;
  const connection = await getIMSPool().getConnection();
  let manifestId = 0;
  let candidates: ManifestShipmentRow[] = [];
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.execute<any[]>(
      `SELECT id, request_hash, status, provider_order_id FROM ims_shipping_manifests
        WHERE business_id = ? AND operation_key = ? FOR UPDATE`,
      [input.businessId, operationKey],
    );
    const existing = existingRows[0];
    if (existing) {
      if (existing.request_hash !== requestHash) throw new Error('This manifest operation key was already used for different shipments.');
      const existingAction = manifestExistingOperationAction(existing.status);
      if (existingAction === 'return') {
        await connection.commit();
        return getShippingManifest(input.businessId, Number(existing.id));
      }
      if (existingAction === 'block') throw new Error('This manifest booking is already in progress. Refresh the workspace before taking another action.');
      if (existingAction === 'reconcile') throw new Error('This manifest has an unknown carrier outcome and must be reconciled before continuing.');
      manifestId = Number(existing.id);
    }

    candidates = await loadManifestCandidatesForUpdate(connection, input.businessId, shipmentIds, manifestId || null);
    const errors = validateManifestCandidates(candidates.map(candidate => ({ ...candidate, manifestId: null })));
    if (errors.length) throw new Error(errors[0]);
    const first = candidates[0];
    if (!manifestId) {
      const [result] = await connection.execute<any>(
        `INSERT INTO ims_shipping_manifests
           (business_id, operation_key, request_hash, carrier_account_id, dispatch_location_id,
            provider, provider_reference, status, shipment_count, parcel_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'submitting', ?, ?)`,
        [input.businessId, operationKey, requestHash, first.carrierAccountId, first.dispatchLocationId,
          first.provider, providerReference, candidates.length, totalParcels(candidates)],
      );
      manifestId = Number(result.insertId);
    } else {
      await connection.execute(
        `UPDATE ims_shipping_manifests SET status = 'submitting', safe_error = NULL
          WHERE business_id = ? AND id = ?`,
        [input.businessId, manifestId],
      );
    }
    const placeholders = shipmentIds.map(() => '?').join(',');
    const [reserved] = await connection.execute<any>(
      `UPDATE ims_shipping_shipments SET manifest_id = ?
        WHERE business_id = ? AND id IN (${placeholders}) AND (manifest_id IS NULL OR manifest_id = ?)`,
      [manifestId, input.businessId, ...shipmentIds, manifestId],
    );
    if (Number(reserved.affectedRows) !== shipmentIds.length) throw new Error('One or more shipments changed while creating the manifest.');
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  try {
    if (candidates[0].provider !== 'auspost_eparcel') throw new Error('This carrier does not support manifests yet.');
    const credentials = await ShippingSettingsRepository.getAccountCredentials(input.businessId, candidates[0].carrierAccountId);
    if (!credentials) throw new Error('Carrier account credentials are incomplete.');
    const client = new AusPostEparcelClient(credentials);
    const response = await client.createOrderFromShipments({
      orderReference: providerReference,
      shipmentIds: candidates.map(candidate => candidate.providerShipmentId!),
    });
    await finalizeManifest(input.businessId, manifestId, response.orderId);
    return getShippingManifest(input.businessId, manifestId);
  } catch (error) {
    const definitive = isDefinitiveManifestFailure(error);
    const safeError = (error instanceof Error ? error.message : 'Carrier manifest creation failed.').slice(0, 500);
    await markManifestFailure(input.businessId, manifestId, definitive ? 'failed' : 'submission_unknown', safeError, definitive);
    if (!definitive) {
      await reportRuntimeIssue({
        businessId: input.businessId, source: 'ims_shipping', operation: 'create_manifest',
        title: 'Carrier manifest outcome requires review', error,
        context: { manifestId, shipmentCount: candidates.length },
        reference: { type: 'shipping_manifest', id: String(manifestId) },
      });
    }
    throw new Error(definitive ? safeError : 'The carrier manifest outcome is unknown. Check the carrier portal before reconciling it in Solvantis.');
  }
}

export async function reconcileShippingManifest(input: {
  businessId: string;
  manifestId: number;
  providerOrderId: string;
}): Promise<ShippingManifestSummary> {
  const manifest = await getManifestForCarrier(input.businessId, input.manifestId, 'submission_unknown');
  const credentials = await ShippingSettingsRepository.getAccountCredentials(input.businessId, manifest.carrierAccountId);
  if (!credentials) throw new Error('Carrier account credentials are incomplete.');
  const client = new AusPostEparcelClient(credentials);
  const order = await client.getOrder(input.providerOrderId.trim());
  const expected = [...manifest.providerShipmentIds].sort();
  const actual = [...order.shipmentIds].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('The carrier order does not contain the expected shipments.');
  await finalizeManifest(input.businessId, input.manifestId, order.orderId);
  return getShippingManifest(input.businessId, input.manifestId);
}

export async function getShippingManifestSummaryPdf(businessId: string, manifestId: number): Promise<{
  bytes: Uint8Array;
  filename: string;
}> {
  const manifest = await getManifestForCarrier(businessId, manifestId, 'complete');
  if (!manifest.providerOrderId) throw new Error('The carrier order ID is unavailable.');
  const credentials = await ShippingSettingsRepository.getAccountCredentials(businessId, manifest.carrierAccountId);
  if (!credentials) throw new Error('Carrier account credentials are incomplete.');
  const bytes = await new AusPostEparcelClient(credentials).getOrderSummaryPdf(manifest.providerOrderId);
  return { bytes, filename: `manifest-${manifest.providerOrderId.replace(/[^A-Za-z0-9_-]/g, '-')}.pdf` };
}

async function loadManifestCandidatesForUpdate(connection: any, businessId: string, shipmentIds: number[], manifestId: number | null): Promise<ManifestShipmentRow[]> {
  const placeholders = shipmentIds.map(() => '?').join(',');
  const [rows] = await connection.execute<any[]>(
    `SELECT shipment.id AS shipmentId, shipment.carrier_account_id AS carrierAccountId,
            shipment.dispatch_location_id AS dispatchLocationId, shipment.provider,
            shipment.provider_shipment_id AS providerShipmentId, shipment.status AS shipmentStatus,
            shipment.ims_fulfilled_at AS imsFulfilledAt, shipment.manifest_id AS manifestId,
            sales_order.so_number AS soNumber,
            COALESCE(NULLIF(sales_order.shopify_order_name, ''), NULLIF(sales_order.native_checkout_id, '')) AS channelOrderNumber,
            account.display_name AS carrierName, location.name AS dispatchLocationName,
            shipment.charged_cost AS chargedCost,
            (SELECT latest.status FROM ims_shipping_labels latest
              WHERE latest.business_id = shipment.business_id AND latest.shipment_id = shipment.id
              ORDER BY latest.id DESC LIMIT 1) AS labelStatus,
            (SELECT COUNT(*) FROM ims_shipping_parcels parcel
              WHERE parcel.business_id = shipment.business_id AND parcel.shipment_id = shipment.id) AS parcelCount
       FROM ims_shipping_shipments shipment
       JOIN ims_sales_orders sales_order ON sales_order.id = shipment.so_id AND sales_order.business_id = shipment.business_id
       JOIN ims_shipping_carrier_accounts account ON account.id = shipment.carrier_account_id AND account.business_id = shipment.business_id
       LEFT JOIN ims_locations location ON location.id = shipment.dispatch_location_id AND location.business_id = shipment.business_id
      WHERE shipment.business_id = ? AND shipment.id IN (${placeholders})
        AND (shipment.manifest_id IS NULL OR shipment.manifest_id = ?)
      FOR UPDATE`,
    [businessId, ...shipmentIds, manifestId],
  );
  if (rows.length !== shipmentIds.length) throw new Error('One or more dispatched shipments were not found or are already manifested.');
  return rows.map(normalizeCandidateRow);
}

async function finalizeManifest(businessId: string, manifestId: number, providerOrderId: string): Promise<void> {
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE ims_shipping_manifests
          SET provider_order_id = ?, status = 'complete', submitted_at = COALESCE(submitted_at, NOW()),
              completed_at = NOW(), safe_error = NULL
        WHERE business_id = ? AND id = ?`,
      [providerOrderId, businessId, manifestId],
    );
    await connection.execute(
      `UPDATE ims_shipping_shipments SET manifested_at = COALESCE(manifested_at, NOW())
        WHERE business_id = ? AND manifest_id = ?`,
      [businessId, manifestId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function markManifestFailure(businessId: string, manifestId: number, status: string, safeError: string, releaseShipments: boolean): Promise<void> {
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE ims_shipping_manifests SET status = ?, safe_error = ? WHERE business_id = ? AND id = ?`,
      [status, safeError, businessId, manifestId],
    );
    if (releaseShipments) {
      await connection.execute(
        `UPDATE ims_shipping_shipments SET manifest_id = NULL WHERE business_id = ? AND manifest_id = ?`,
        [businessId, manifestId],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getShippingManifest(businessId: string, manifestId: number): Promise<ShippingManifestSummary> {
  const rows = await imsQuery<any>(
    `SELECT manifest.id, manifest.provider, manifest.provider_reference AS providerReference,
            manifest.provider_order_id AS providerOrderId, manifest.status,
            manifest.carrier_account_id AS carrierAccountId, account.display_name AS carrierName,
            manifest.dispatch_location_id AS dispatchLocationId, location.name AS dispatchLocationName,
            manifest.shipment_count AS shipmentCount, manifest.parcel_count AS parcelCount,
            manifest.safe_error AS safeError, manifest.created_at AS createdAt, manifest.completed_at AS completedAt
       FROM ims_shipping_manifests manifest
       JOIN ims_shipping_carrier_accounts account ON account.id = manifest.carrier_account_id AND account.business_id = manifest.business_id
       LEFT JOIN ims_locations location ON location.id = manifest.dispatch_location_id AND location.business_id = manifest.business_id
      WHERE manifest.business_id = ? AND manifest.id = ? LIMIT 1`,
    [businessId, manifestId],
  );
  if (!rows[0]) throw new Error('Manifest was not found.');
  const row = rows[0];
  return {
    ...row,
    id: Number(row.id), carrierAccountId: Number(row.carrierAccountId),
    dispatchLocationId: row.dispatchLocationId == null ? null : Number(row.dispatchLocationId),
    shipmentCount: Number(row.shipmentCount), parcelCount: Number(row.parcelCount),
  };
}

async function getManifestForCarrier(businessId: string, manifestId: number, requiredStatus: string): Promise<{
  carrierAccountId: number;
  providerOrderId: string | null;
  providerShipmentIds: string[];
}> {
  const rows = await imsQuery<any>(
    `SELECT manifest.carrier_account_id AS carrierAccountId, manifest.provider_order_id AS providerOrderId,
            shipment.provider_shipment_id AS providerShipmentId
       FROM ims_shipping_manifests manifest
       LEFT JOIN ims_shipping_shipments shipment
         ON shipment.manifest_id = manifest.id AND shipment.business_id = manifest.business_id
      WHERE manifest.business_id = ? AND manifest.id = ? AND manifest.status = ?`,
    [businessId, manifestId, requiredStatus],
  );
  if (!rows.length) throw new Error('Manifest was not found or is not ready for this action.');
  return {
    carrierAccountId: Number(rows[0].carrierAccountId),
    providerOrderId: rows[0].providerOrderId,
    providerShipmentIds: rows.map(row => String(row.providerShipmentId ?? '')).filter(Boolean),
  };
}

function normalizeCandidateRow(row: any): ManifestShipmentRow {
  return {
    ...row,
    shipmentId: Number(row.shipmentId), carrierAccountId: Number(row.carrierAccountId),
    dispatchLocationId: row.dispatchLocationId == null ? null : Number(row.dispatchLocationId),
    manifestId: row.manifestId == null ? null : Number(row.manifestId),
    parcelCount: Number(row.parcelCount), chargedCost: row.chargedCost == null ? null : Number(row.chargedCost),
  };
}

function normalizedIds(ids: number[]): number[] {
  return [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(id => Number.isInteger(id) && id > 0))].sort((left, right) => left - right);
}

function manifestRequestHash(shipmentIds: number[]): string {
  return createHash('sha256').update(JSON.stringify(shipmentIds)).digest('hex');
}

function totalParcels(candidates: ManifestCandidate[]): number {
  return candidates.reduce((sum, candidate) => sum + candidate.parcelCount, 0);
}

export function isDefinitiveManifestFailure(error: unknown): boolean {
  if (/does not support|credentials are incomplete/i.test(error instanceof Error ? error.message : '')) return true;
  return error instanceof AusPostApiError && error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status);
}

export function manifestExistingOperationAction(status: string): 'return' | 'retry' | 'block' | 'reconcile' {
  if (status === 'complete') return 'return';
  if (status === 'submission_unknown') return 'reconcile';
  if (status === 'submitting') return 'block';
  return 'retry';
}
