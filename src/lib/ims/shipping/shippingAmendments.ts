import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool } from '@/services/IMSMySQLService';
import {
  AusPostApiError, AusPostEparcelClient, type AusPostReadShipment, type AusPostUpdateShipmentRequest,
} from './carriers/auspostEparcel/client';
import { prepareShippingRequest, validateShippingRecipient, type PreparedShippingRequest } from './shippingDrafts';
import { quotePreparedShippingRequest } from './shippingQuotes';
import { ShippingSettingsRepository } from './shippingSettingsRepository';
import { supersedeShippingLabels } from './shippingLabelRevisions';
import {
  amendmentRequestHash, carrierAmendmentsEnabled, getShipmentEditEligibility,
  isDefinitiveAmendmentRejection, ShippingAmendmentError,
  validateAmendmentConcurrency, validateAmendmentIdentity,
} from './shippingAmendmentPolicy';
import type {
  ShippingAmendmentDraft, ShippingAmendmentInput, ShippingAmendmentResult,
  ShippingEditableDetail, ShippingEditableOrderItem,
} from './shippingAmendmentTypes';
import type { CustomsSnapshot } from './customs';

type ShipmentRow = RowDataPacket & {
  id: number; so_id: number; revision: number; updated_at: Date | string; status: string;
  carrier_account_id: number | null; provider_shipment_id: string | null; provider: string;
  provider_reference: string; recipient_json: unknown; customs_json: unknown; sender_json: unknown;
  service_code: string | null; service_name: string | null; quoted_cost: number | null;
  quoted_cost_ex_gst: number | null; quoted_gst: number | null; is_international: number;
  charged_cost: number | null;
  ims_fulfilled_at: unknown; manifest_id: unknown; ims_fulfilment_operation_key: unknown;
};
export type ShippingPreparationAmendmentInput = Omit<ShippingAmendmentInput, 'service'> & {
  service: null; preparationOnly: true;
};
type AmendableInput = ShippingAmendmentInput | ShippingPreparationAmendmentInput;
type DesiredSnapshot = {
  input: AmendableInput;
  prepared: {
    account: PreparedShippingRequest['account'];
    entries: Array<Omit<PreparedShippingRequest['entries'][number], 'order'> & { order: { id: number } }>;
  };
  orderGuard: string;
  remoteRequest?: AusPostUpdateShipmentRequest;
  affectedShipmentIds: number[];
};
type AmendmentRow = RowDataPacket & {
  id: number; shipment_id: number; request_hash: string; status: string;
  previous_json: unknown; desired_json: unknown; result_json: unknown; safe_error: string | null;
  updated_at: Date | string;
};

export async function getShippingEditableDetail(businessId: string, shipmentId: number): Promise<ShippingEditableDetail> {
  const connection = await getIMSPool().getConnection();
  let detail: ShippingEditableDetail;
  try {
    const row = await getShipment(connection, businessId, shipmentId);
    detail = await buildDetail(connection, businessId, row);
  } finally { connection.release(); }
  const customer = await resolveShippingOrderCustomerName(businessId, detail.soId, detail.recipient.name);
  return {
    ...detail,
    suggestedRecipientName: customer.name && isPlaceholderShippingCustomerName(detail.recipient.name) ? customer.name : null,
    recipientNameIssue: customer.issue,
    order: { ...detail.order, customer_name: customer.name ?? detail.order.customer_name },
  };
}

export async function quoteShippingAmendment(
  businessId: string, shipmentId: number,
  input: ShippingAmendmentDraft & { expectedRevision: number; expectedUpdatedAt: string },
) {
  if (!input) throw new ShippingAmendmentError('Shipment details are required.');
  const detail = await getShippingEditableDetail(businessId, shipmentId);
  validateAmendmentConcurrency(detail, input);
  assertEditable(detail);
  if (input.carrierAccountId === null) throw new ShippingAmendmentError('Choose a carrier account before getting prices.');
  const prepared = await prepareAmendment(businessId, detail, input);
  const quotes = await quotePreparedShippingRequest(businessId, input.carrierAccountId, prepared);
  return quotes[0]?.rates ?? [];
}

export async function amendShippingShipment(
  businessId: string, shipmentId: number, input: AmendableInput,
): Promise<ShippingAmendmentResult> {
  validateOperation(input);
  const hash = amendmentRequestHash(input);
  const existing = await findOperation(businessId, shipmentId, input.operationKey);
  if (existing) return replay(existing, hash);
  const detail = await getShippingEditableDetail(businessId, shipmentId);
  validateAmendmentConcurrency(detail, input);
  assertEditable(detail);
  if (input.service === null && detail.providerShipmentId)
    throw new ShippingAmendmentError('Booked shipments require a reviewed postage service.', 409);
  if (detail.providerShipmentId && input.confirmCarrierUpdate !== true)
    throw new ShippingAmendmentError('Review the new postage and confirm the carrier update before saving.');
  const orderGuard = await getOrderGuard(businessId, detail.soId);
  const prepared = await prepareAmendment(businessId, detail, input);
  if (input.service) {
    if (input.carrierAccountId === null) throw new ShippingAmendmentError('Choose a carrier account before saving postage.');
    const service = input.service;
    const quotes = await quotePreparedShippingRequest(businessId, input.carrierAccountId, prepared);
    const quoted = quotes[0]?.rates.find(rate => rate.serviceCode === service.serviceCode);
    if (!quoted || ['total', 'totalExGst', 'gst'].some(key =>
      Math.abs(quoted[key as 'total'] - service[key as 'total']) > 0.005) ||
      quoted.serviceName !== service.serviceName)
      throw new ShippingAmendmentError('Shipping prices changed. Refresh prices and review the service again.', 409);
  }

  let client: AusPostEparcelClient | undefined;
  let remoteRequest: AusPostUpdateShipmentRequest | undefined;
  let previousCarrierReadback: AusPostReadShipment | undefined;
  if (detail.providerShipmentId) {
    if (detail.carrierAccountId === null) throw new Error('A booked shipment is missing its carrier account.');
    client = await carrierClient(businessId, detail.carrierAccountId);
    previousCarrierReadback = await client.getShipment(detail.providerShipmentId);
    remoteRequest = buildCarrierAmendmentRequest(detail, input, prepared, previousCarrierReadback);
  }
  const desired: DesiredSnapshot = {
    input, prepared: { account: prepared.account, entries: prepared.entries.map(({ order, ...entry }) => ({ ...entry, order: { id: order.id } })) },
    orderGuard, remoteRequest, affectedShipmentIds: [shipmentId],
  };
  if (previousCarrierReadback?.from) {
    const from = previousCarrierReadback.from;
    desired.prepared.entries[0].sender = {
      name: from.name, lines: from.lines, suburb: from.suburb ?? '', state: from.state ?? '',
      postcode: from.postcode ?? '', country: from.country ?? 'AU', phone: from.phone ?? '',
    };
  }
  const connection = await getIMSPool().getConnection();
  let operationId = 0;
  try {
    await connection.beginTransaction();
    const row = await getShipment(connection, businessId, shipmentId, true);
    const raced = await getOperation(connection, businessId, shipmentId, input.operationKey);
    if (raced) {
      await connection.rollback();
      return replay(raced, hash);
    }
    validateAmendmentConcurrency({ revision: Number(row.revision), updatedAt: iso(row.updated_at) }, input);
    if (input.service === null) {
      const [memberships] = await connection.execute<RowDataPacket[]>(
        'SELECT batch_key FROM ims_shipping_batch_memberships WHERE business_id = ? AND shipment_id = ? FOR UPDATE',
        [businessId, shipmentId],
      );
      if (row.provider_shipment_id || memberships.length !== 1 || memberships[0].batch_key !== null)
        throw new ShippingAmendmentError('This order has joined a batch or been booked. Refresh before saving dimensions.', 409);
    }
    const eligibility = getShipmentEditEligibility(row);
    if (!eligibility.eligible) throw new ShippingAmendmentError(eligibility.reason!, 409);
    await assertOrderGuard(connection, businessId, detail.soId, orderGuard);
    await assertPresets(connection, businessId, input.parcels);
    const [insert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO ims_shipping_amendments
        (business_id, shipment_id, operation_key, request_hash, expected_revision, status, previous_json, desired_json)
       VALUES (?, ?, ?, ?, ?, 'claimed', ?, ?)`,
      [businessId, shipmentId, input.operationKey, hash, input.expectedRevision,
        JSON.stringify({ detail, shipment: row, carrier: previousCarrierReadback ?? null }), JSON.stringify(desired)],
    );
    operationId = Number(insert.insertId);
    await connection.execute(
      'UPDATE ims_shipping_shipments SET revision = revision + 1, updated_at = NOW() WHERE business_id = ? AND id = ?',
      [businessId, shipmentId],
    );
    if (detail.providerShipmentId) {
      try {
        desired.affectedShipmentIds = await supersedeShippingLabels(connection, businessId, shipmentId);
      } catch (error) {
        if (error instanceof Error && /shared label/i.test(error.message))
          throw new ShippingAmendmentError(error.message, 409);
        throw error;
      }
      await connection.execute(
        "UPDATE ims_shipping_shipments SET status = 'amending', safe_error = NULL WHERE business_id = ? AND id = ?",
        [businessId, shipmentId],
      );
      await connection.execute(
        'UPDATE ims_shipping_amendments SET desired_json = ? WHERE business_id = ? AND id = ?',
        [JSON.stringify(desired), businessId, operationId],
      );
      await connection.commit();
    } else {
      await applyLocalSnapshot(connection, businessId, shipmentId, desired, false);
      const result = await resultFor(connection, businessId, shipmentId, desired, false);
      await confirmOperation(connection, businessId, operationId, result);
      await connection.commit();
      return result;
    }
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }

  // No transaction or row lock spans the carrier request.
  let providerUpdateSucceeded = false;
  try {
    await client!.updateShipment(detail.providerShipmentId!, remoteRequest!);
    providerUpdateSucceeded = true;
    const readback = await client!.getShipment(detail.providerShipmentId!);
    if (!carrierReadbackMatches(readback, remoteRequest!, detail.providerShipmentId!))
      throw new Error('Carrier readback did not verify the desired shipment details.');
    return await finalizeCarrierAmendment(businessId, shipmentId, operationId, desired, readback);
  } catch (error) {
    const rejected = !providerUpdateSucceeded && isDefinitiveAmendmentRejection(error);
    await recordCarrierFailure(businessId, shipmentId, operationId, rejected, desired.affectedShipmentIds);
    await reportAmendmentIssue(businessId, shipmentId, rejected ? 'carrier_amendment_rejected' : 'carrier_amendment_unknown', error);
    throw new ShippingAmendmentError(
      rejected
        ? 'The carrier rejected this amendment. Previous shipment details are unchanged. Old labels were discarded; regenerate fresh labels before dispatch.'
        : 'The carrier amendment outcome is unknown. Dispatch is blocked. Read back the carrier shipment to reconcile; do not retry the carrier update.',
      rejected ? 400 : 409, desired.affectedShipmentIds, true,
    );
  }
}

export async function reconcileShippingAmendment(businessId: string, shipmentId: number): Promise<ShippingAmendmentResult> {
  const connection = await getIMSPool().getConnection();
  let operation: AmendmentRow;
  let row: ShipmentRow;
  try {
    row = await getShipment(connection, businessId, shipmentId);
    const [rows] = await connection.execute<AmendmentRow[]>(
      `SELECT * FROM ims_shipping_amendments WHERE business_id = ? AND shipment_id = ?
        AND status IN ('claimed', 'unknown') ORDER BY id DESC LIMIT 1`,
      [businessId, shipmentId],
    );
    if (!rows[0] || !['amending', 'amendment_unknown'].includes(row.status))
      throw new ShippingAmendmentError('There is no unresolved shipment amendment to reconcile.', 409);
    operation = rows[0];
    if (operation.status === 'claimed' && Date.now() - new Date(operation.updated_at).getTime() < 120_000)
      throw new ShippingAmendmentError('The carrier amendment is still in flight. Wait before requesting readback.', 409);
  } finally { connection.release(); }
  const desired = parseJson<DesiredSnapshot>(operation.desired_json);
  if (!row.provider_shipment_id || !desired.remoteRequest)
    throw new ShippingAmendmentError('The unresolved amendment has no verified carrier identity.', 409);
  try {
    const client = await carrierClient(businessId, Number(row.carrier_account_id));
    const readback = await client.getShipment(row.provider_shipment_id);
    if (!carrierReadbackMatches(readback, desired.remoteRequest, row.provider_shipment_id))
      throw new ShippingAmendmentError('Carrier readback is unresolved. Saved details are not verified; dispatch remains blocked. No carrier update was replayed.', 409, desired.affectedShipmentIds, true);
    return await finalizeCarrierAmendment(businessId, shipmentId, Number(operation.id), desired, readback);
  } catch (error) {
    if (!(error instanceof ShippingAmendmentError))
      await reportAmendmentIssue(businessId, shipmentId, 'reconcile_carrier_amendment', error);
    if (error instanceof ShippingAmendmentError) throw error;
    throw new ShippingAmendmentError('Carrier readback is unavailable. The amendment remains unresolved and dispatch is blocked.', 409, desired.affectedShipmentIds, true);
  }
}

async function prepareAmendment(businessId: string, detail: ShippingEditableDetail, input: ShippingAmendmentDraft & { preparationOnly?: boolean }): Promise<PreparedShippingRequest> {
  if (!input) throw new ShippingAmendmentError('Shipment details are required.');
  const recipient = validateShippingRecipient(input.recipient);
  validateAmendmentIdentity(detail, { ...input, recipient });
  return prepareShippingRequest({
    businessId, carrierAccountId: input.carrierAccountId, preparationOnly: input.preparationOnly === true,
    shipments: [{ soId: detail.soId, recipient, parcels: input.parcels,
      exportPurpose: input.exportPurpose, nonSaleValues: input.nonSaleValues, nonSaleValuesConfirmed: input.nonSaleValuesConfirmed }],
  });
}

function validateOperation(input: AmendableInput): void {
  if (!input || typeof input.operationKey !== 'string' || !/^[A-Za-z0-9:_-]{1,150}$/.test(input.operationKey))
    throw new ShippingAmendmentError('A valid operation key is required.');
  if (input.service === null && 'preparationOnly' in input && input.preparationOnly === true) return;
  if (!input.service || typeof input.service.serviceCode !== 'string' || !input.service.serviceCode.trim() ||
      input.service.serviceCode.length > 50 || typeof input.service.serviceName !== 'string' ||
      !input.service.serviceName.trim() || input.service.serviceName.length > 120 ||
      ![input.service.total, input.service.totalExGst, input.service.gst].every(value => Number.isFinite(value) && value >= 0))
    throw new ShippingAmendmentError('A valid quoted shipping service is required.');
}
function assertEditable(detail: ShippingEditableDetail): void {
  if (!detail.editEligibility.eligible) throw new ShippingAmendmentError(detail.editEligibility.reason!, 409);
}
async function carrierClient(businessId: string, accountId: number): Promise<AusPostEparcelClient> {
  const credentials = await ShippingSettingsRepository.getAccountCredentials(businessId, accountId);
  if (!credentials) throw new ShippingAmendmentError('Carrier account credentials are incomplete.');
  return new AusPostEparcelClient(credentials);
}

async function getShipment(connection: PoolConnection, businessId: string, shipmentId: number, lock = false): Promise<ShipmentRow> {
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) throw new ShippingAmendmentError('A valid shipment ID is required.');
  const [rows] = await connection.execute<ShipmentRow[]>(
    `SELECT * FROM ims_shipping_shipments WHERE business_id = ? AND id = ? ${lock ? 'FOR UPDATE' : ''}`, [businessId, shipmentId],
  );
  if (!rows[0]) throw new ShippingAmendmentError('Shipment not found.', 404);
  return rows[0];
}
async function buildDetail(connection: PoolConnection, businessId: string, row: ShipmentRow): Promise<ShippingEditableDetail> {
  const order = await ImsSORepo.get(Number(row.so_id), businessId, connection);
  if (!order) throw new ShippingAmendmentError('Sales order not found.', 404);
  const [parcels] = await connection.execute<RowDataPacket[]>(
    'SELECT * FROM ims_shipping_parcels WHERE business_id = ? AND shipment_id = ? ORDER BY parcel_number', [businessId, row.id],
  );
  const [allocations] = await connection.execute<RowDataPacket[]>(
    `SELECT i.* FROM ims_shipping_parcel_items i JOIN ims_shipping_parcels p ON p.id = i.parcel_id AND p.business_id = i.business_id
     WHERE i.business_id = ? AND p.shipment_id = ? ORDER BY i.so_item_id`, [businessId, row.id],
  );
  const raw = order as unknown as Record<string, unknown>;
  const nullable = (key: string) => raw[key] == null ? null : String(raw[key]);
  const recipient = parseJson<ShippingEditableDetail['recipient']>(row.recipient_json);
  return {
    shipmentId: Number(row.id), revision: Number(row.revision), updatedAt: iso(row.updated_at), status: row.status,
    soId: Number(row.so_id), soNumber: order.so_number, carrierAccountId: row.carrier_account_id == null ? null : Number(row.carrier_account_id),
    providerShipmentId: row.provider_shipment_id, isInternational: Boolean(Number(row.is_international)),
    editEligibility: getShipmentEditEligibility(row), carrierUpdateEnabled: carrierAmendmentsEnabled(Boolean(Number(row.is_international))),
    recipient, customs: row.customs_json == null ? null : parseJson<CustomsSnapshot>(row.customs_json),
    service: row.service_code ? { serviceCode: row.service_code, serviceName: row.service_name ?? row.service_code,
      total: Number(row.quoted_cost ?? 0), totalExGst: Number(row.quoted_cost_ex_gst ?? 0), gst: Number(row.quoted_gst ?? 0) } : null,
    chargedCost: row.charged_cost == null ? null : Number(row.charged_cost),
    parcels: parcels.map(p => ({
      parcelId: Number(p.id), providerItemId: p.provider_item_id ?? null, packagePresetId: p.package_preset_id == null ? null : Number(p.package_preset_id),
      packageType: p.package_type, parcelNumber: Number(p.parcel_number), lengthMm: Number(p.length_mm),
      widthMm: Number(p.width_mm), heightMm: Number(p.height_mm), weightKg: Number(p.weight_kg),
      allocations: allocations.filter(i => Number(i.parcel_id) === Number(p.id)).map(i => ({ soItemId: Number(i.so_item_id), quantity: Number(i.quantity) })),
    })),
    order: {
      id: order.id, so_number: order.so_number, status: order.status, so_type: nullable('so_type'), tax_treatment: order.tax_treatment ?? 'ex_tax',
      customer_name: recipient.name && !isPlaceholderShippingCustomerName(recipient.name) ? recipient.name : order.customer_name ?? '',
      customer_email: nullable('customer_email'), customer_phone: nullable('customer_phone'),
      contact_id: raw.customer_id == null ? null : Number(raw.customer_id),
      delivery_address: nullable('delivery_address'), delivery_address2: nullable('delivery_address2'), delivery_suburb: nullable('delivery_suburb'),
      delivery_city: nullable('delivery_city'), delivery_state: nullable('delivery_state'), delivery_postcode: nullable('delivery_postcode'),
      delivery_country: nullable('delivery_country'),
      items: (order.items ?? []).map(i => ({
        id: Number(i.id), sku: String(i.sku ?? i.code ?? ''), product_name: String(i.product_name ?? i.name ?? i.notes ?? ''),
        notes: i.notes ?? null, product_id: i.product_id == null ? null : String(i.product_id),
        qty_ordered: Number(i.qty_ordered), qty_fulfilled: Number(i.qty_fulfilled), unit_price: Number(i.unit_price),
        discount_pct: Number(i.discount_pct ?? 0), tax_rate: Number(i.tax_rate ?? 0), customs_description: i.customs_description ?? null,
        hs_code: i.hs_code ?? null, country_of_origin: i.country_of_origin ?? null, is_dangerous_or_restricted: Boolean(i.is_dangerous_or_restricted),
        weight_kg: i.weight_kg == null ? null : Number(i.weight_kg),
      } satisfies ShippingEditableOrderItem)),
    },
  };
}

async function getOrderGuard(businessId: string, soId: number): Promise<string> {
  const connection = await getIMSPool().getConnection();
  try { return await orderGuard(connection, businessId, soId); } finally { connection.release(); }
}
async function orderGuard(connection: PoolConnection, businessId: string, soId: number, lock = false): Promise<string> {
  const [headers] = await connection.execute<RowDataPacket[]>(
    `SELECT * FROM ims_sales_orders WHERE business_id = ? AND id = ? ${lock ? 'FOR UPDATE' : ''}`, [businessId, soId],
  );
  if (!headers[0]) throw new ShippingAmendmentError('Sales order not found.', 404);
  const [items] = await connection.execute<RowDataPacket[]>(
    `SELECT * FROM ims_sales_order_items WHERE business_id = ? AND so_id = ? ORDER BY id ${lock ? 'FOR UPDATE' : ''}`, [businessId, soId],
  );
  return amendmentRequestHash({ order: headers[0], items });
}
async function assertOrderGuard(connection: PoolConnection, businessId: string, soId: number, expected: string): Promise<void> {
  if (await orderGuard(connection, businessId, soId, true) !== expected)
    throw new ShippingAmendmentError('Sales order changed while editing. Reload before saving; an unresolved carrier update must be reconciled first.', 409);
}
async function assertPresets(connection: PoolConnection, businessId: string, parcels: ShippingAmendmentInput['parcels']): Promise<void> {
  for (const id of new Set(parcels.flatMap(p => p.packagePresetId == null ? [] : [p.packagePresetId]))) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      'SELECT id FROM ims_shipping_package_presets WHERE business_id = ? AND id = ? AND is_active = 1', [businessId, id],
    );
    if (!rows.length) throw new ShippingAmendmentError('Active package preset not found for this business.');
  }
}
async function findOperation(businessId: string, shipmentId: number, key: string): Promise<AmendmentRow | undefined> {
  const connection = await getIMSPool().getConnection();
  try { return await getOperation(connection, businessId, shipmentId, key); } finally { connection.release(); }
}
async function getOperation(connection: PoolConnection, businessId: string, shipmentId: number, key: string): Promise<AmendmentRow | undefined> {
  const [rows] = await connection.execute<AmendmentRow[]>(
    'SELECT * FROM ims_shipping_amendments WHERE business_id = ? AND shipment_id = ? AND operation_key = ?', [businessId, shipmentId, key],
  );
  return rows[0];
}
function replay(row: AmendmentRow, hash: string): ShippingAmendmentResult {
  if (row.request_hash !== hash) throw new ShippingAmendmentError('This operation key was already used with different shipment details.', 409);
  if (row.status === 'confirmed' && row.result_json) return parseJson<ShippingAmendmentResult>(row.result_json);
  const desired = parseJson<DesiredSnapshot>(row.desired_json);
  throw new ShippingAmendmentError(
    row.status === 'rejected' ? 'The carrier rejected this operation. Old labels were discarded; regenerate fresh labels before dispatch.'
      : 'This operation is in flight or unknown. Read back the carrier shipment to reconcile; no carrier update was replayed.',
    row.status === 'rejected' ? 400 : 409, desired.affectedShipmentIds, Boolean(desired.remoteRequest),
  );
}

async function applyLocalSnapshot(connection: PoolConnection, businessId: string, shipmentId: number, desired: DesiredSnapshot, carrier: boolean): Promise<void> {
  const entry = desired.prepared.entries[0];
  const input = desired.input;
  await connection.execute(
    `UPDATE ims_shipping_shipments SET carrier_account_id = ?, provider = ?, dispatch_location_id = ?,
      status = ?, service_code = ?, service_name = ?, quoted_cost = ?, quoted_cost_ex_gst = ?, quoted_gst = ?,
      sender_json = ?, recipient_json = ?, is_international = ?, export_purpose = ?, declared_currency = ?,
      customs_json = ?, request_hash = ?, safe_error = NULL, label_ready_at = NULL, updated_at = NOW()
     WHERE business_id = ? AND id = ?`,
    [input.carrierAccountId, desired.prepared.account.provider, entry.dispatchLocationId, carrier ? 'carrier_created' : 'draft',
      input.service?.serviceCode ?? null, input.service?.serviceName ?? null,
      input.service?.total ?? null, input.service?.totalExGst ?? null, input.service?.gst ?? null,
      JSON.stringify(entry.sender), JSON.stringify(entry.recipient), entry.isInternational ? 1 : 0,
      entry.customs?.exportPurpose ?? null, entry.customs?.declaredCurrency ?? null, entry.customs ? JSON.stringify(entry.customs) : null,
      amendmentRequestHash({ shipment: entry.requested, service: input.service, customs: entry.customs }), businessId, shipmentId],
  );
  const [saved] = await connection.execute<RowDataPacket[]>(
    'SELECT id FROM ims_shipping_parcels WHERE business_id = ? AND shipment_id = ? FOR UPDATE', [businessId, shipmentId],
  );
  // Existing rows keep their identities; only local drafts may add or remove rows.
  const keep = new Set(input.parcels.map(p => p.parcelId));
  for (const parcel of saved) {
    await connection.execute('DELETE FROM ims_shipping_parcel_items WHERE business_id = ? AND parcel_id = ?', [businessId, parcel.id]);
    if (!keep.has(Number(parcel.id))) {
      if (carrier) throw new ShippingAmendmentError('Carrier parcel identity changed.', 409);
      await connection.execute('DELETE FROM ims_shipping_parcels WHERE business_id = ? AND shipment_id = ? AND id = ?', [businessId, shipmentId, parcel.id]);
    }
  }
  // Avoid transient unique-number collisions when a local draft reorders parcels.
  if (!carrier) await connection.execute(
    'UPDATE ims_shipping_parcels SET parcel_number = -id WHERE business_id = ? AND shipment_id = ?', [businessId, shipmentId],
  );
  for (const p of input.parcels) {
    const values = [p.packagePresetId ?? null, p.parcelNumber, p.packageType, p.lengthMm, p.widthMm, p.heightMm, p.weightKg];
    let parcelId = p.parcelId;
    if (parcelId) {
      await connection.execute(
        `UPDATE ims_shipping_parcels SET package_preset_id = ?, parcel_number = ?, package_type = ?,
         length_mm = ?, width_mm = ?, height_mm = ?, weight_kg = ? WHERE business_id = ? AND shipment_id = ? AND id = ?`,
        [...values, businessId, shipmentId, parcelId],
      );
    } else {
      const [insert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO ims_shipping_parcels
         (package_preset_id, parcel_number, package_type, length_mm, width_mm, height_mm, weight_kg, business_id, shipment_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...values, businessId, shipmentId],
      );
      parcelId = Number(insert.insertId);
    }
    for (const allocation of p.allocations) await connection.execute(
      'INSERT INTO ims_shipping_parcel_items (business_id, parcel_id, so_item_id, quantity) VALUES (?, ?, ?, ?)',
      [businessId, parcelId, allocation.soItemId, allocation.quantity],
    );
  }
  if (input.service !== null) {
    const r = entry.recipient;
    await connection.execute(
      `UPDATE ims_sales_orders SET delivery_address = ?, delivery_address2 = ?, delivery_suburb = ?, delivery_city = ?,
        delivery_state = ?, delivery_postcode = ?, delivery_country = ? WHERE business_id = ? AND id = ?`,
      [r.lines[0], r.lines[1] ?? null, r.suburb, r.suburb, r.state, r.postcode, r.country, businessId, entry.order.id],
    );
  }
}

async function finalizeCarrierAmendment(businessId: string, shipmentId: number, operationId: number, desired: DesiredSnapshot, readback: AusPostReadShipment): Promise<ShippingAmendmentResult> {
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const row = await getShipment(connection, businessId, shipmentId, true);
    const [operations] = await connection.execute<AmendmentRow[]>(
      'SELECT * FROM ims_shipping_amendments WHERE business_id = ? AND shipment_id = ? AND id = ? FOR UPDATE',
      [businessId, shipmentId, operationId],
    );
    const operation = operations[0];
    if (!operation) throw new ShippingAmendmentError('Amendment operation not found.', 409);
    if (operation.status === 'confirmed') {
      await connection.rollback();
      return parseJson<ShippingAmendmentResult>(operation.result_json);
    }
    if (!['claimed', 'unknown'].includes(operation.status) || !['amending', 'amendment_unknown'].includes(row.status) ||
        Number(row.revision) !== desired.input.expectedRevision + 1 || row.manifest_id || row.ims_fulfilled_at || row.ims_fulfilment_operation_key)
      throw new ShippingAmendmentError('Shipment state changed during amendment; dispatch remains blocked.', 409);
    await assertOrderGuard(connection, businessId, Number(row.so_id), desired.orderGuard);
    await applyLocalSnapshot(connection, businessId, shipmentId, desired, true);
    const summary = readback.shipment_summary;
    await connection.execute(
      `UPDATE ims_shipping_shipments SET charged_cost = ?, charged_cost_ex_gst = ?, charged_gst = ?
       WHERE business_id = ? AND id = ?`,
      [summary?.total_cost ?? null,
        summary?.total_cost_ex_gst ?? (summary?.total_cost != null && summary?.total_gst != null ? Math.round((summary.total_cost - summary.total_gst) * 100) / 100 : null),
        summary?.total_gst ?? null, businessId, shipmentId],
    );
    for (const item of readback.items ?? []) {
      await connection.execute(
        `UPDATE ims_shipping_parcels SET article_id = COALESCE(?, article_id), consignment_id = COALESCE(?, consignment_id)
         WHERE business_id = ? AND shipment_id = ? AND provider_item_id = ?`,
        [item.tracking_details?.article_id ?? null, item.tracking_details?.consignment_id ?? null, businessId, shipmentId, item.item_id ?? null],
      );
    }
    const result = await resultFor(connection, businessId, shipmentId, desired, true);
    await confirmOperation(connection, businessId, operationId, result);
    await connection.commit();
    return result;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
async function resultFor(connection: PoolConnection, businessId: string, shipmentId: number, desired: DesiredSnapshot, carrier: boolean): Promise<ShippingAmendmentResult> {
  const shipment = await buildDetail(connection, businessId, await getShipment(connection, businessId, shipmentId));
  const r = desired.prepared.entries[0].recipient;
  Object.assign(shipment.order, {
    delivery_address: r.lines[0], delivery_address2: r.lines[1] ?? null, delivery_suburb: r.suburb,
    delivery_city: r.suburb, delivery_state: r.state, delivery_postcode: r.postcode, delivery_country: r.country,
  });
  return {
    shipment,
    affectedShipmentIds: desired.affectedShipmentIds, requiresFreshLabels: carrier,
  };
}
async function confirmOperation(connection: PoolConnection, businessId: string, id: number, result: ShippingAmendmentResult): Promise<void> {
  await connection.execute(
    "UPDATE ims_shipping_amendments SET status = 'confirmed', result_json = ?, safe_error = NULL, completed_at = NOW() WHERE business_id = ? AND id = ?",
    [JSON.stringify(result), businessId, id],
  );
}
async function recordCarrierFailure(businessId: string, shipmentId: number, operationId: number, rejected: boolean, affected: number[]): Promise<void> {
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    await getShipment(connection, businessId, shipmentId, true);
    const message = rejected ? 'Carrier rejected amendment; previous details retained; regenerate labels.' : 'Carrier amendment outcome unknown; readback required.';
    await connection.execute(
      `UPDATE ims_shipping_amendments SET status = ?, safe_error = ? WHERE business_id = ? AND id = ? AND status IN ('claimed', 'unknown')`,
      [rejected ? 'rejected' : 'unknown', message, businessId, operationId],
    );
    await connection.execute(
      `UPDATE ims_shipping_shipments SET status = ?, safe_error = ? WHERE business_id = ? AND id = ? AND status IN ('amending', 'amendment_unknown')`,
      [rejected ? 'carrier_created' : 'amendment_unknown', message, businessId, shipmentId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    await reportAmendmentIssue(businessId, shipmentId, 'persist_amendment_unknown', error);
    throw new ShippingAmendmentError('Unable to persist carrier outcome. Shipment remains blocked; reconcile by readback.', 409, affected, true);
  } finally { connection.release(); }
}
async function reportAmendmentIssue(businessId: string, shipmentId: number, operation: string, error: unknown): Promise<void> {
  await reportRuntimeIssue({
    businessId, source: 'ims_shipping', operation, title: 'Shipment amendment could not be confirmed',
    error: new Error(error instanceof ShippingAmendmentError ? error.message : 'Carrier amendment or readback failed.'),
    context: { shipmentId, errorType: error instanceof Error ? error.name : 'unknown',
      carrierHttpStatus: error instanceof AusPostApiError ? error.status : null },
    reference: { type: 'shipping_shipment', id: shipmentId },
  });
}

const SHIPMENT_FIELDS = ['shipment_reference', 'customer_reference_1', 'customer_reference_2', 'email_tracking_enabled',
  'options', 'sender_references', 'contains_s8_goods', 'movement_type', 'charge_to_account'] as const;
const ADDRESS_FIELDS = ['name', 'business_name', 'type', 'apcn', 'lines', 'suburb', 'state', 'postcode', 'country', 'email', 'phone', 'delivery_instructions'];
const ITEM_FIELDS = ['item_id', 'item_reference', 'product_id', 'item_description', 'length', 'width', 'height', 'weight',
  'contains_dangerous_goods', 'authority_to_leave', 'safe_drop_enabled', 'allow_partial_delivery', 'features', 'classification_type',
  'commercial_value', 'landed_costs_payer', 'item_contents', 'export_declaration_number', 'description_of_other',
  'international_parcel_sender_name', 'non_delivery_action', 'certificate_number', 'licence_number', 'invoice_number', 'comments'];
function pick(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const object = value as Record<string, unknown>;
  return Object.fromEntries(keys.filter(key => object?.[key] != null).map(key => [key, object[key]]));
}
export function buildCarrierAmendmentRequest(detail: ShippingEditableDetail, input: AmendableInput, prepared: PreparedShippingRequest, remote: AusPostReadShipment): AusPostUpdateShipmentRequest {
  const service = input.service;
  if (!service) throw new ShippingAmendmentError('A reviewed carrier service is required.');
  if (remote.shipment_id !== detail.providerShipmentId || remote.order_id || remote.shipment_summary?.order_id || !remote.from || !remote.to ||
      !remote.items || remote.items.length !== detail.parcels.length)
    throw new ShippingAmendmentError('Carrier readback does not identify an unmanifested shipment with the saved parcels.', 409);
  const summary = remote.shipment_summary as (typeof remote.shipment_summary & { status?: string });
  const state = String(remote.status ?? summary?.status ?? '').toLowerCase();
  if (state !== 'created')
    throw new ShippingAmendmentError('Carrier shipment state is unknown or no longer editable.', 409);
  validateAmendmentIdentity(detail, { ...input, recipient: prepared.entries[0].recipient });
  if ((String(remote.to.country ?? 'AU').toUpperCase() !== 'AU') !== detail.isInternational)
    throw new ShippingAmendmentError('Carrier destination category differs from the saved shipment.', 409);
  const previous = {
    ...pick(remote, SHIPMENT_FIELDS), shipment_reference: remote.shipment_reference!,
    from: pick(remote.from, ADDRESS_FIELDS), to: { ...pick(remote.to, ADDRESS_FIELDS), ...detail.recipient },
    items: detail.parcels.map(parcel => ({
      ...pick(remote.items!.find(item => item.item_id === parcel.providerItemId), ITEM_FIELDS),
      item_id: parcel.providerItemId!, product_id: detail.service?.serviceCode ?? '',
      length: Math.round(parcel.lengthMm) / 10, width: Math.round(parcel.widthMm) / 10,
      height: Math.round(parcel.heightMm) / 10, weight: parcel.weightKg,
    })),
  } as AusPostUpdateShipmentRequest;
  if (!carrierReadbackMatches(remote, previous, detail.providerShipmentId!))
    throw new ShippingAmendmentError('Carrier details differ from the saved shipment. Reconcile them before editing.', 409);
  const items = input.parcels.map(parcel => {
    const matches = remote.items!.filter(item => item.item_id === parcel.providerItemId);
    if (matches.length !== 1) throw new ShippingAmendmentError('Carrier item identities do not match the saved parcels.', 409);
    const original = matches[0];
    const result = {
      ...pick(original, ITEM_FIELDS), item_id: parcel.providerItemId!, product_id: service.serviceCode,
      length: Math.round(parcel.lengthMm / 10 * 10) / 10, width: Math.round(parcel.widthMm / 10 * 10) / 10,
      height: Math.round(parcel.heightMm / 10 * 10) / 10, weight: parcel.weightKg,
    };
    if (detail.isInternational) {
      const customs = prepared.entries[0].customs!;
      const contents = customs.parcels.find(p => p.parcelNumber === parcel.parcelNumber)!;
      const classification = { sale: 'SALE_OF_GOODS', gift: 'GIFT', sample: 'SAMPLE', return: 'RETURN' };
      Object.assign(result, {
        classification_type: classification[customs.exportPurpose], commercial_value: true,
        item_description: contents.items.map(i => i.description).join(', ').slice(0, 50),
        item_contents: contents.items.map((item, index) => ({
          country_of_origin: item.countryOfOrigin, description: item.description, sku: item.sku, quantity: item.quantity,
          tariff_code: item.hsCode, value: item.totalValue, weight: item.weightKg,
          item_contents_reference: `${original.item_reference ?? parcel.providerItemId}-C${index + 1}`.slice(0, 50),
        })),
      });
      delete (result as Record<string, unknown>).authority_to_leave;
    }
    return result;
  });
  const recipient = prepared.entries[0].recipient;
  const reference = String(remote.shipment_reference ?? '');
  if (!reference) throw new ShippingAmendmentError('Carrier source reference is unavailable.', 409);
  return {
    ...pick(remote, SHIPMENT_FIELDS), shipment_reference: reference,
    from: pick(remote.from, ADDRESS_FIELDS) as AusPostUpdateShipmentRequest['from'],
    to: { ...pick(remote.to, ADDRESS_FIELDS), ...recipient }, items,
  };
}
export function carrierReadbackMatches(remote: AusPostReadShipment, desired: AusPostUpdateShipmentRequest, shipmentId: string): boolean {
  if (remote.shipment_id !== shipmentId || remote.order_id || remote.shipment_summary?.order_id || remote.shipment_reference !== desired.shipment_reference ||
      !remote.items || remote.items.length !== desired.items.length) return false;
  const summary = remote.shipment_summary as (typeof remote.shipment_summary & { status?: string });
  if (String(remote.status ?? summary?.status ?? '').toLowerCase() !== 'created') return false;
  for (const field of SHIPMENT_FIELDS) {
    if (desired[field] != null && amendmentRequestHash(remote[field]) !== amendmentRequestHash(desired[field])) return false;
  }
  for (const side of ['from', 'to'] as const) {
    if (!remote[side]) return false;
    for (const [key, value] of Object.entries(desired[side])) {
      const actual = (remote[side] as Record<string, unknown>)[key];
      if (key === 'country' && value === 'AU' && (actual == null || actual === 'AUSTRALIA')) continue;
      if (value === '' && actual == null) continue;
      if (amendmentRequestHash(actual) !== amendmentRequestHash(value)) return false;
    }
  }
  for (const item of desired.items) {
    const matches = remote.items.filter(actual => actual.item_id === item.item_id);
    if (matches.length !== 1) return false;
    for (const [key, value] of Object.entries(item)) {
      const actual = matches[0][key];
      if (['length', 'width', 'height', 'weight'].includes(key)) {
        if (!Number.isFinite(Number(actual)) || Math.abs(Number(actual) - Number(value)) > 0.0001) return false;
      } else if (amendmentRequestHash(actual) !== amendmentRequestHash(value)) return false;
    }
  }
  return true;
}
function parseJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}
function iso(value: string | Date): string { return new Date(value).toISOString(); }
import { isPlaceholderShippingCustomerName, resolveShippingOrderCustomerName } from './shippingCustomerNames';
