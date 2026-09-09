import { createHash } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { ImsLocationsRepo, ImsSORepo } from '@/lib/ims/ImsRepository';
import { getIMSPool } from '@/services/IMSMySQLService';
import { getShippingOrderEligibility, validateShippingParcels } from './shippingWorkflow';
import type { ShippingParcelDraft } from './types';

export type ShippingDraftInput = {
  businessId: string;
  operationKey: string;
  carrierAccountId: number;
  shipments: ShippingRequestInput['shipments'];
};

export type ShippingRequestInput = {
  businessId: string;
  carrierAccountId: number;
  shipments: Array<{
    soId: number;
    parcels: Array<ShippingParcelDraft & { packagePresetId?: number | null; packageType?: string }>;
  }>;
};

export type PreparedShippingRequest = {
  account: { id: number; provider: string; dispatchLocationId: number | null };
  entries: Array<{
    requested: ShippingRequestInput['shipments'][number];
    order: NonNullable<Awaited<ReturnType<typeof ImsSORepo.get>>> & { so_type?: string | null };
    dispatchLocationId: number;
    sender: { name: string; lines: string[]; suburb: string; state: string; postcode: string; country: string; phone: string };
    recipient: { name: string; lines: string[]; suburb: string; state: string; postcode: string; country: string; email: string };
  }>;
};

export async function createShippingDrafts(input: ShippingDraftInput): Promise<Array<{ soId: number; shipmentId: number }>> {
  const operationKey = input.operationKey.trim();
  if (!operationKey || operationKey.length > 150) throw new Error('A valid operation key is required.');
  const { account, entries: prepared } = await prepareShippingRequest(input);

  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const result: Array<{ soId: number; shipmentId: number }> = [];
    for (const entry of prepared) {
      const shipmentOperationKey = `${operationKey}:${entry.order.id}`;
      const requestHash = createHash('sha256').update(JSON.stringify(entry.requested)).digest('hex');
      const providerReference = `${entry.order.so_number}-${operationKey.slice(0, 24)}`;
      const [insert] = await connection.execute<ResultSetHeader>(
        `INSERT IGNORE INTO ims_shipping_shipments
           (business_id, operation_key, request_hash, so_id, carrier_account_id, dispatch_location_id,
            provider, status, provider_reference, sender_json, recipient_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
        [input.businessId, shipmentOperationKey, requestHash, entry.order.id, input.carrierAccountId,
          entry.dispatchLocationId, account.provider, providerReference, JSON.stringify(entry.sender), JSON.stringify(entry.recipient)],
      );
      let shipmentId = Number(insert.insertId);
      if (!shipmentId) {
        const [existing] = await connection.execute<RowDataPacket[]>(
          `SELECT id, request_hash FROM ims_shipping_shipments
            WHERE business_id = ? AND operation_key = ? FOR UPDATE`,
          [input.businessId, shipmentOperationKey],
        );
        if (!existing[0] || existing[0].request_hash !== requestHash) throw new Error('This shipping operation key was already used with different parcels.');
        shipmentId = Number(existing[0].id);
        result.push({ soId: entry.order.id, shipmentId });
        continue;
      }
      for (const parcel of entry.requested.parcels) {
        const [parcelInsert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO ims_shipping_parcels
             (business_id, shipment_id, package_preset_id, parcel_number, package_type,
              length_mm, width_mm, height_mm, weight_kg)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [input.businessId, shipmentId, parcel.packagePresetId ?? null, parcel.parcelNumber,
            parcel.packageType || 'box', parcel.lengthMm, parcel.widthMm, parcel.heightMm, parcel.weightKg],
        );
        for (const allocation of parcel.allocations) {
          await connection.execute(
            `INSERT INTO ims_shipping_parcel_items (business_id, parcel_id, so_item_id, quantity)
             VALUES (?, ?, ?, ?)`,
            [input.businessId, parcelInsert.insertId, allocation.soItemId, allocation.quantity],
          );
        }
      }
      result.push({ soId: entry.order.id, shipmentId });
    }
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function prepareShippingRequest(input: ShippingRequestInput): Promise<PreparedShippingRequest> {
  if (!Number.isInteger(input.carrierAccountId) || input.carrierAccountId <= 0) throw new Error('Choose a carrier account.');
  if (!input.shipments.length) throw new Error('Choose at least one sales order.');

  const accountRows = await queryRows<RowDataPacket & { id: number; provider: string; dispatch_location_id: number | null }>(
    `SELECT id, provider, dispatch_location_id FROM ims_shipping_carrier_accounts
      WHERE business_id = ? AND id = ? AND is_active = 1 LIMIT 1`,
    [input.businessId, input.carrierAccountId],
  );
  const accountRow = accountRows[0];
  if (!accountRow) throw new Error('Active carrier account not found.');

  const entries: PreparedShippingRequest['entries'] = [];
  for (const requested of input.shipments) {
    const order = await ImsSORepo.get(Number(requested.soId), input.businessId);
    if (!order?.items) throw new Error(`Sales order ${requested.soId} was not found.`);
    const remainingQuantity = order.items.reduce((sum, item) => sum + Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled)), 0);
    const eligibility = getShippingOrderEligibility({ status: order.status, soType: (order as typeof order & { so_type?: string | null }).so_type, remainingQuantity });
    if (!eligibility.eligible) throw new Error(`${order.so_number}: ${eligibility.reason}`);
    const lines = order.items.map(item => ({ soItemId: Number(item.id), remainingQuantity: Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled)) }));
    const parcelErrors = validateShippingParcels(lines, requested.parcels);
    if (parcelErrors.length) throw new Error(`${order.so_number}: ${parcelErrors[0]}`);
    const dispatchLocationId = Number(accountRow.dispatch_location_id ?? order.location_id);
    if (!Number.isInteger(dispatchLocationId) || dispatchLocationId <= 0) throw new Error(`${order.so_number}: dispatch location is required.`);
    const location = await ImsLocationsRepo.get(dispatchLocationId, input.businessId);
    if (!location) throw new Error(`${order.so_number}: dispatch location not found.`);
    const sender = { name: location.name, lines: [location.address].filter((line): line is string => Boolean(line)), suburb: location.city || '', state: location.state || '', postcode: location.postcode || '', country: location.country || 'AU', phone: location.phone || '' };
    const recipient = { name: order.customer_name || order.so_number, lines: [order.delivery_address, order.delivery_address2].filter((line): line is string => Boolean(line)), suburb: order.delivery_suburb || order.delivery_city || '', state: order.delivery_state || '', postcode: order.delivery_postcode || '', country: order.delivery_country || 'AU', email: order.customer_email || '' };
    const missingSenderFields = [!sender.lines.length ? 'street address' : '', !sender.suburb ? 'suburb/city' : '', !sender.state ? 'state' : '', !sender.postcode ? 'postcode' : ''].filter(Boolean);
    if (missingSenderFields.length) throw new Error(`${order.so_number}: dispatch location ${location.name} is missing ${missingSenderFields.join(', ')}.`);
    if (!recipient.lines.length || !recipient.suburb || !recipient.state || !recipient.postcode) throw new Error(`${order.so_number}: delivery address is incomplete.`);
    entries.push({ requested, order, dispatchLocationId, sender, recipient });
  }
  return {
    account: { id: Number(accountRow.id), provider: accountRow.provider, dispatchLocationId: accountRow.dispatch_location_id },
    entries,
  };
}

async function queryRows<T extends RowDataPacket>(sql: string, params: Array<string | number | null>): Promise<T[]> {
  const connection = await getIMSPool().getConnection();
  try {
    const [rows] = await connection.execute<RowDataPacket[]>(sql, params);
    return rows as T[];
  } finally {
    connection.release();
  }
}
