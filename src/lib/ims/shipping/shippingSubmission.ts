import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { AusPostApiError, AusPostEparcelClient } from './carriers/auspostEparcel/client';
import type { CarrierAddress, CarrierRate } from './carriers/types';
import { aggregateCarrierRates } from './shippingQuotes';
import { ShippingSettingsRepository } from './shippingSettingsRepository';

type ShipmentRow = {
  id: number;
  so_id: number;
  so_number: string;
  channel_order_number: string | null;
  carrier_account_id: number;
  provider: string;
  status: string;
  provider_shipment_id: string | null;
  provider_reference: string;
  service_code: string | null;
  service_name: string | null;
  quoted_cost: number | null;
  sender_json: string | CarrierAddress;
  recipient_json: string | CarrierAddress;
};

type ParcelRow = {
  id: number;
  parcel_number: number;
  length_mm: number;
  width_mm: number;
  height_mm: number;
  weight_kg: number;
};

type AusPostShipmentResponse = {
  shipments?: AusPostCreatedShipment[];
};

type AusPostCreatedShipment = {
  shipment_id?: string;
  shipment_reference?: string;
  items?: Array<{
    item_id?: string;
    item_reference?: string;
    tracking_details?: { article_id?: string; consignment_id?: string };
  }>;
  shipment_summary?: { total_cost?: number; total_cost_ex_gst?: number; total_gst?: number };
};

type AusPostLabelResponse = {
  labels?: Array<{
    request_id?: string;
    url?: string;
    status?: string;
    shipment_ids?: string[];
  }>;
};

export type ShippingSubmissionResult = {
  shipmentId: number;
  soId: number;
  status: 'label_pending' | 'label_ready';
  providerShipmentId: string;
  labelUrl: string | null;
  chargedCost: number | null;
};

export async function submitShippingDraftsAndCreateLabels(input: {
  businessId: string;
  shipmentIds: number[];
}): Promise<ShippingSubmissionResult[]> {
  const shipmentIds = [...new Set(input.shipmentIds.map(Number))];
  if (!shipmentIds.length || shipmentIds.some(id => !Number.isInteger(id) || id <= 0)) {
    throw new Error('Choose at least one prepared shipment.');
  }
  if (shipmentIds.length > 50) throw new Error('Submit no more than 50 shipments at once.');

  const shipments: ShipmentRow[] = [];
  for (const shipmentId of shipmentIds) shipments.push(await submitOneShipment(input.businessId, shipmentId));
  const labels = await ensureBatchLabels(input.businessId, shipments);
  return Promise.all(shipments.map(async shipment => {
    const label = labels.get(shipment.id);
    const chargedRows = await imsQuery<{ charged_cost: number | null }>(
      'SELECT charged_cost FROM ims_shipping_shipments WHERE business_id = ? AND id = ? LIMIT 1',
      [input.businessId, shipment.id],
    );
    return {
      shipmentId: shipment.id,
      soId: Number(shipment.so_id),
      status: label?.status === 'AVAILABLE' ? 'label_ready' : 'label_pending',
      providerShipmentId: text(shipment.provider_shipment_id),
      labelUrl: label?.url ?? null,
      chargedCost: chargedRows[0]?.charged_cost == null ? null : Number(chargedRows[0].charged_cost),
    };
  }));
}

async function submitOneShipment(businessId: string, shipmentId: number): Promise<ShipmentRow> {
  let shipment = await getShipment(businessId, shipmentId);
  if (!shipment) throw new Error(`Prepared shipment ${shipmentId} was not found.`);
  if (shipment.provider !== 'auspost_eparcel') throw new Error('Carrier submission is not supported for this shipment.');
  if (!shipment.service_code || !shipment.service_name) throw new Error(`${shipment.so_number}: choose and save a shipping service before submission.`);

  const credentials = await ShippingSettingsRepository.getAccountCredentials(businessId, Number(shipment.carrier_account_id));
  if (!credentials) throw new Error('Carrier account credentials are incomplete.');
  const client = new AusPostEparcelClient(credentials);
  const parcels = await getParcels(businessId, shipmentId);
  if (!parcels.length) throw new Error(`${shipment.so_number}: the prepared shipment has no parcels.`);

  if (!shipment.provider_shipment_id) {
    const liveRates = aggregateCarrierRates(await client.getRates({
      from: parseAddress(shipment.sender_json),
      to: parseAddress(shipment.recipient_json),
      parcels: parcels.map(parcel => ({
        reference: parcelReference(shipmentId, parcel.parcel_number),
        lengthMm: Number(parcel.length_mm),
        widthMm: Number(parcel.width_mm),
        heightMm: Number(parcel.height_mm),
        weightKg: Number(parcel.weight_kg),
      })),
    }));
    validateSelectedShippingRate(shipment, liveRates);
    if (shipment.status === 'submitting' || shipment.status === 'submission_unknown') {
      throw new Error(`${shipment.so_number}: carrier submission outcome is unknown. Review it before retrying to avoid duplicate postage.`);
    }
    const claimed = await imsExecute(
      `UPDATE ims_shipping_shipments
          SET status = 'submitting', safe_error = NULL
        WHERE business_id = ? AND id = ? AND provider_shipment_id IS NULL
          AND status IN ('draft', 'failed')`,
      [businessId, shipmentId],
    );
    if (!claimed.affectedRows) {
      shipment = await getShipment(businessId, shipmentId) ?? shipment;
      if (!shipment.provider_shipment_id) throw new Error(`${shipment.so_number}: this shipment is already being submitted.`);
    } else {
      try {
        const response = await client.createDomesticShipments({
          shipments: [buildAusPostDomesticShipment(shipment, parcels)],
        }) as AusPostShipmentResponse;
        const created = response.shipments?.[0];
        const providerShipmentId = text(created?.shipment_id);
        if (!created || !providerShipmentId) throw new Error('Australia Post did not return a shipment ID. Submission outcome requires review.');
        await persistCarrierShipment(businessId, shipment, parcels, created);
        shipment = { ...shipment, status: 'carrier_created', provider_shipment_id: providerShipmentId };
      } catch (error) {
        const safeError = safeCarrierError(error);
        const rejected = error instanceof AusPostApiError && error.status >= 400 && error.status < 500;
        await imsExecute(
          `UPDATE ims_shipping_shipments SET status = ?, safe_error = ? WHERE business_id = ? AND id = ? AND provider_shipment_id IS NULL`,
          [rejected ? 'draft' : 'submission_unknown', safeError, businessId, shipmentId],
        );
        throw error;
      }
    }
  }

  if (!text(shipment.provider_shipment_id)) throw new Error(`${shipment.so_number}: Australia Post shipment ID is unavailable.`);
  return shipment;
}

async function ensureBatchLabels(
  businessId: string,
  shipments: ShipmentRow[],
): Promise<Map<number, { requestId: string; status: string; url?: string }>> {
  const accountIds = new Set(shipments.map(shipment => Number(shipment.carrier_account_id)));
  if (accountIds.size !== 1) throw new Error('A label batch must use one Australia Post carrier account.');
  const credentials = await ShippingSettingsRepository.getAccountCredentials(businessId, [...accountIds][0]);
  if (!credentials) throw new Error('Carrier account credentials are incomplete.');
  const client = new AusPostEparcelClient(credentials);
  const results = new Map<number, { requestId: string; status: string; url?: string }>();
  const unlabelled: ShipmentRow[] = [];
  const polledRequests = new Map<string, AusPostLabelResponse>();

  for (const shipment of shipments) {
    const existing = (await imsQuery<{
      provider_request_id: string | null; status: string; label_url: string | null; label_url_expires_at: string | Date | null;
  }>(
      `SELECT provider_request_id, status, label_url, label_url_expires_at FROM ims_shipping_labels
        WHERE business_id = ? AND shipment_id = ? ORDER BY id DESC LIMIT 1`,
      [businessId, shipment.id],
    ))[0];
    if (existing?.provider_request_id) {
      const expiresAt = existing.label_url_expires_at ? new Date(existing.label_url_expires_at).getTime() : null;
      if (existing.status === 'available' && existing.label_url && (!expiresAt || expiresAt > Date.now())) {
        results.set(shipment.id, { requestId: existing.provider_request_id, status: 'AVAILABLE', url: existing.label_url });
        continue;
      }
      if (existing.status !== 'error') {
        let response = polledRequests.get(existing.provider_request_id);
        if (!response) {
          response = await client.getLabel(existing.provider_request_id) as AusPostLabelResponse;
          polledRequests.set(existing.provider_request_id, response);
        }
        results.set(shipment.id, await persistLabelResponse(businessId, shipment.id, existing.provider_request_id, response));
        continue;
      }
    }
    if (shipment.status === 'label_submitting' || shipment.status === 'label_unknown') {
      throw new Error(`${shipment.so_number}: label request outcome is unknown. Review it before retrying.`);
    }
    unlabelled.push(shipment);
  }
  if (!unlabelled.length) return results;

  const claimedShipments: ShipmentRow[] = [];
  try {
    for (const shipment of unlabelled) {
      const claimed = await imsExecute(
        `UPDATE ims_shipping_shipments SET status = 'label_submitting', safe_error = NULL
          WHERE business_id = ? AND id = ? AND provider_shipment_id = ? AND status IN ('carrier_created', 'failed')`,
        [businessId, shipment.id, shipment.provider_shipment_id],
      );
      if (!claimed.affectedRows) {
        for (const claimedShipment of claimedShipments) {
          await imsExecute(
            `UPDATE ims_shipping_shipments SET status = 'carrier_created'
              WHERE business_id = ? AND id = ? AND status = 'label_submitting'`,
            [businessId, claimedShipment.id],
          );
        }
        throw new Error(`${shipment.so_number}: a label request is already in progress.`);
      }
      claimedShipments.push(shipment);
    }
    const preferences = [...new Map(unlabelled.map(shipment => {
      const preference = getAusPostLabelPreference(shipment.service_name ?? '');
      return [`${preference.group}:${preference.layout}`, preference];
    })).values()];
    const response = await client.createLabels({
      wait_for_label_url: true,
      unlabelled_articles_only: false,
      preferences: [{ type: 'PRINT', format: 'PDF', groups: preferences.map(preference => ({ ...preference, branded: true, left_offset: 0, top_offset: 0 })) }],
      shipments: unlabelled.map(shipment => ({ shipment_id: text(shipment.provider_shipment_id) })),
    }) as AusPostLabelResponse;
    for (const shipment of unlabelled) {
      const providerShipmentId = text(shipment.provider_shipment_id);
      const responseLabel = response.labels?.find(label => label.shipment_ids?.map(text).includes(providerShipmentId))
        ?? (response.labels?.length === 1 ? response.labels[0] : undefined);
      const requestId = text(responseLabel?.request_id);
      if (!requestId) throw new Error('Australia Post did not return a label request ID. Label outcome requires review.');
      const preference = getAusPostLabelPreference(shipment.service_name ?? '');
      await imsExecute(
        `INSERT INTO ims_shipping_labels
           (business_id, shipment_id, provider_request_id, format, layout, status)
         VALUES (?, ?, ?, 'PDF', ?, 'pending')`,
        [businessId, shipment.id, requestId, preference.layout],
      );
      results.set(shipment.id, await persistLabelResponse(businessId, shipment.id, requestId, response));
    }
    return results;
  } catch (error) {
    const safeError = safeCarrierError(error);
    const rejected = error instanceof AusPostApiError && error.status >= 400 && error.status < 500;
    for (const shipment of unlabelled) {
      await imsExecute(
        `UPDATE ims_shipping_shipments SET status = ?, safe_error = ? WHERE business_id = ? AND id = ?`,
        [rejected ? 'carrier_created' : 'label_unknown', safeError, businessId, shipment.id],
      );
    }
    throw error;
  }
}

async function persistCarrierShipment(
  businessId: string,
  shipment: ShipmentRow,
  parcels: ParcelRow[],
  created: AusPostCreatedShipment,
): Promise<void> {
  const summary = created.shipment_summary ?? {};
  await imsExecute(
    `UPDATE ims_shipping_shipments
        SET status = 'carrier_created', provider_shipment_id = ?, charged_cost = ?,
            charged_cost_ex_gst = ?, charged_gst = ?, carrier_created_at = NOW(), safe_error = NULL
      WHERE business_id = ? AND id = ? AND status = 'submitting'`,
    [text(created.shipment_id), numberOrNull(summary.total_cost), numberOrNull(summary.total_cost_ex_gst),
      numberOrNull(summary.total_gst), businessId, shipment.id],
  );
  const parcelByReference = new Map(parcels.map(parcel => [parcelReference(shipment, parcel.parcel_number), parcel]));
  for (const item of created.items ?? []) {
    const parcel = parcelByReference.get(text(item.item_reference));
    if (!parcel) continue;
    await imsExecute(
      `UPDATE ims_shipping_parcels
          SET provider_item_id = ?, article_id = ?, consignment_id = ?
        WHERE business_id = ? AND id = ? AND shipment_id = ?`,
      [text(item.item_id) || null, text(item.tracking_details?.article_id) || null,
        text(item.tracking_details?.consignment_id) || null, businessId, parcel.id, shipment.id],
    );
  }
}

async function persistLabelResponse(
  businessId: string,
  shipmentId: number,
  requestId: string,
  response: AusPostLabelResponse,
): Promise<{ requestId: string; status: string; url?: string }> {
  const label = response.labels?.find(item => text(item.request_id) === requestId) ?? response.labels?.[0];
  const status = text(label?.status).toUpperCase() || 'PENDING';
  const url = text(label?.url) || undefined;
  const available = status === 'AVAILABLE' && Boolean(url);
  await imsExecute(
    `UPDATE ims_shipping_labels
        SET status = ?, label_url = ?, label_url_expires_at = ?, available_at = ?, safe_error = ?
      WHERE business_id = ? AND shipment_id = ? AND provider_request_id = ?`,
    [available ? 'available' : status.toLowerCase(), url ?? null, labelUrlExpiry(url),
      available ? new Date() : null, status === 'ERROR' ? 'Australia Post could not generate this label.' : null,
      businessId, shipmentId, requestId],
  );
  await imsExecute(
    `UPDATE ims_shipping_shipments SET status = ?, label_ready_at = ?, safe_error = ?
      WHERE business_id = ? AND id = ?`,
    [available ? 'label_ready' : status === 'ERROR' ? 'carrier_created' : 'label_pending',
      available ? new Date() : null, status === 'ERROR' ? 'Australia Post could not generate this label.' : null,
      businessId, shipmentId],
  );
  if (status === 'ERROR') throw new Error('Australia Post could not generate this label.');
  return { requestId, status: available ? 'AVAILABLE' : status, url };
}

async function getShipment(businessId: string, shipmentId: number): Promise<ShipmentRow | null> {
  return (await imsQuery<ShipmentRow>(
    `SELECT shipment.id, shipment.so_id, sales_order.so_number,
            COALESCE(NULLIF(sales_order.shopify_order_name, ''), NULLIF(sales_order.native_checkout_id, '')) AS channel_order_number,
            shipment.carrier_account_id,
            shipment.provider, shipment.status, shipment.provider_shipment_id,
            shipment.provider_reference, shipment.service_code, shipment.service_name, shipment.quoted_cost,
            shipment.sender_json, shipment.recipient_json
       FROM ims_shipping_shipments shipment
       JOIN ims_sales_orders sales_order ON sales_order.id = shipment.so_id AND sales_order.business_id = shipment.business_id
      WHERE shipment.business_id = ? AND shipment.id = ? LIMIT 1`,
    [businessId, shipmentId],
  ))[0] ?? null;
}

async function getParcels(businessId: string, shipmentId: number): Promise<ParcelRow[]> {
  return imsQuery<ParcelRow>(
    `SELECT id, parcel_number, length_mm, width_mm, height_mm, weight_kg
       FROM ims_shipping_parcels WHERE business_id = ? AND shipment_id = ? ORDER BY parcel_number`,
    [businessId, shipmentId],
  );
}

export function buildAusPostDomesticShipment(shipment: ShipmentRow, parcels: ParcelRow[]) {
  const sender = parseAddress(shipment.sender_json);
  const recipient = parseAddress(shipment.recipient_json);
  return {
    shipment_reference: shipment.provider_reference.slice(0, 50),
    customer_reference_1: shipment.so_number.slice(0, 50),
    ...(shipment.channel_order_number ? { customer_reference_2: shipment.channel_order_number.slice(0, 50) } : {}),
    contains_s8_goods: false,
    from: carrierAddressPayload(sender),
    to: carrierAddressPayload(recipient),
    items: parcels.map(parcel => ({
      item_reference: parcelReference(shipment, parcel.parcel_number),
      product_id: shipment.service_code,
      length: millimetresToCentimetres(parcel.length_mm),
      width: millimetresToCentimetres(parcel.width_mm),
      height: millimetresToCentimetres(parcel.height_mm),
      weight: Number(parcel.weight_kg),
      authority_to_leave: false,
      allow_partial_delivery: true,
    })),
  };
}

export function getAusPostLabelPreference(serviceName: string): { group: 'Parcel Post' | 'Express Post'; layout: 'A4-4pp' | 'A4-3pp' } {
  return /express/i.test(serviceName)
    ? { group: 'Express Post', layout: 'A4-3pp' }
    : { group: 'Parcel Post', layout: 'A4-4pp' };
}

function carrierAddressPayload(address: CarrierAddress) {
  return {
    name: address.name,
    ...(address.businessName ? { business_name: address.businessName } : {}),
    lines: address.lines,
    suburb: address.suburb,
    state: address.state,
    postcode: address.postcode,
    ...(address.phone ? { phone: address.phone } : {}),
    ...(address.email ? { email: address.email } : {}),
  };
}

function parseAddress(value: string | CarrierAddress): CarrierAddress {
  return typeof value === 'string' ? JSON.parse(value) as CarrierAddress : value;
}

function parcelReference(shipment: Pick<ShipmentRow, 'id' | 'so_number' | 'channel_order_number'>, parcelNumber: number): string {
  const references = [shipment.so_number, shipment.channel_order_number].filter(Boolean).join(' ');
  return `${references || `S${shipment.id}`} P${parcelNumber}`.slice(0, 50);
}

function millimetresToCentimetres(value: number): number {
  return Math.round((Number(value) / 10) * 10) / 10;
}

function labelUrlExpiry(url: string | undefined): Date | null {
  if (!url) return null;
  try {
    const expires = Number(new URL(url).searchParams.get('Expires'));
    return Number.isFinite(expires) && expires > 0 ? new Date(expires * 1000) : null;
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function safeCarrierError(error: unknown): string {
  return (error instanceof Error ? error.message : 'Carrier request failed.').slice(0, 500);
}

export function validateSelectedShippingRate(
  shipment: Pick<ShipmentRow, 'so_number' | 'service_code' | 'quoted_cost'>,
  rates: Array<Pick<CarrierRate, 'serviceCode' | 'total'>>,
): void {
  const selected = rates.find(rate => rate.serviceCode === shipment.service_code);
  if (!selected) throw new Error(`${shipment.so_number}: the selected shipping service is no longer available. Refresh prices and prepare a new shipment.`);
  if (Math.round(Number(selected.total) * 100) !== Math.round(Number(shipment.quoted_cost) * 100)) {
    throw new Error(`${shipment.so_number}: the shipping price changed. Refresh prices and prepare a new shipment before submitting.`);
  }
}