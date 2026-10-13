import { createHash } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { ImsLocationsRepo, ImsSORepo } from "@/lib/ims/ImsRepository";
import { getIMSPool } from "@/services/IMSMySQLService";
import {
  buildCustomsSnapshot,
  getInternationalRecipientErrors,
  normalizeIsoAlpha2,
  type CustomsSnapshot,
  type NonSaleDeclaredValueInput,
  type ShippingExportPurpose,
} from "./customs";
import {
  getShippingOrderEligibility,
  isAustralianShippingCountry,
  validateShippingParcels,
} from "./shippingWorkflow";
import type { ShippingParcelDraft } from "./types";
import type { ShippingAmendmentRecipient } from "./shippingAmendmentTypes";
import { lockShippingBatchShipments } from "./shippingBatches";
import { getShippingBatchId, ShippingBatchError, validateShippingBatchId } from "./shippingBatchTypes";

export type ShippingDraftInput = {
  businessId: string;
  operationKey: string;
  batchId?: string | null;
  preparationOnly?: boolean;
  carrierAccountId: number | null;
  shipments: Array<
    ShippingRequestInput["shipments"][number] & {
      service?: {
        serviceCode: string;
        serviceName: string;
        total: number;
        totalExGst: number;
        gst: number;
      };
    }
  >;
};

export type ShippingRequestInput = {
  businessId: string;
  carrierAccountId: number | null;
  preparationOnly?: boolean;
  shipments: Array<{
    soId: number;
    recipient?: ShippingAmendmentRecipient;
    exportPurpose?: ShippingExportPurpose;
    nonSaleValues?: NonSaleDeclaredValueInput[];
    nonSaleValuesConfirmed?: boolean;
    parcels: Array<
      ShippingParcelDraft & {
        packagePresetId?: number | null;
        packageType?: string;
      }
    >;
  }>;
};

export type PreparedShippingRequest = {
  account: { id: number | null; provider: string; dispatchLocationId: number | null };
  entries: Array<{
    requested: ShippingRequestInput["shipments"][number];
    order: NonNullable<Awaited<ReturnType<typeof ImsSORepo.get>>> & {
      so_type?: string | null;
    };
    dispatchLocationId: number;
    sender: {
      name: string;
      lines: string[];
      suburb: string;
      state: string;
      postcode: string;
      country: string;
      phone: string;
    };
    recipient: {
      name: string;
      lines: string[];
      suburb: string;
      state: string;
      postcode: string;
      country: string;
      email: string;
      phone: string;
    };
    isInternational: boolean;
    customs: Readonly<CustomsSnapshot> | null;
  }>;
};

export async function createShippingDrafts(
  input: ShippingDraftInput,
): Promise<Array<{ soId: number; shipmentId: number }>> {
  const operationKey = input.operationKey.trim();
  if (!operationKey || operationKey.length > 150)
    throw new Error("A valid operation key is required.");
  if (input.batchId !== undefined && input.batchId !== null) validateShippingBatchId(input.batchId);
  if (input.preparationOnly && input.batchId !== null)
    throw new ShippingBatchError("Order preparation must be saved without a batch.", 400);
  if (!input.preparationOnly && input.batchId === null)
    throw new ShippingBatchError("Choose a destination batch.", 400);
  if (!Array.isArray(input.shipments) || !input.shipments.length || input.shipments.length > 50 ||
      input.shipments.some((entry) => !entry || typeof entry !== "object" ||
        !Number.isSafeInteger(entry.soId) || entry.soId <= 0) ||
      new Set(input.shipments.map((entry) => entry.soId)).size !== input.shipments.length)
    throw new ShippingBatchError("Choose between 1 and 50 unique sales orders.", 400);
  const { account, entries: prepared } = await prepareShippingRequest(input);
  const servicesByOrder = new Map(
    input.shipments.map((shipment) => [shipment.soId, shipment.service]),
  );

  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const soIds = prepared.map((entry) => Number(entry.order.id)).sort((a, b) => a - b);
    const [lockedOrders] = await connection.execute<RowDataPacket[]>(
      `SELECT id, status FROM ims_sales_orders
        WHERE business_id = ? AND id IN (${soIds.map(() => "?").join(",")})
        ORDER BY id FOR UPDATE`, [input.businessId, ...soIds],
    );
    if (lockedOrders.length !== soIds.length)
      throw new ShippingBatchError("Sales order not found.", 404);
    const batchShipments = await lockShippingBatchShipments(connection, input.businessId);
    const newEntries = prepared.filter((entry) => !batchShipments.some((shipment) =>
      shipment.operation_key === `${operationKey}:${entry.order.id}`));
    if (input.batchId != null && newEntries.length &&
        !batchShipments.some((shipment) =>
          getShippingBatchId(shipment.operation_key, shipment.membership_id == null ? null : { batch_key: shipment.batch_key }) === input.batchId &&
          !["voided", "manifested"].includes(shipment.status) && shipment.manifest_id == null))
      throw new ShippingBatchError("The destination batch no longer exists. Refresh the workspace.", 404);
    for (const entry of newEntries) {
      const order = lockedOrders.find((row) => Number(row.id) === Number(entry.order.id));
      if (!order || !["confirmed", "partially_fulfilled"].includes(order.status))
        throw new ShippingBatchError("This sales order is no longer ready to ship.", 409);
      // The Sales Order lock serializes concurrent operation keys before any purchase can be prepared.
      if (batchShipments.some((shipment) => Number(shipment.so_id) === Number(entry.order.id) &&
          shipment.status !== "voided" && shipment.ims_fulfilled_at == null))
        throw new ShippingBatchError("This sales order already has an active shipment. Refresh the workspace.", 409);
    }
    const result: Array<{ soId: number; shipmentId: number }> = [];
    for (const entry of prepared) {
      const service = servicesByOrder.get(entry.requested.soId);
      if (!input.preparationOnly && (!service?.serviceCode?.trim() || !service.serviceName?.trim()))
        throw new Error(
          `${entry.order.so_number}: choose a quoted shipping service.`,
        );
      if (
        service &&
        ![service.total, service.totalExGst, service.gst].every(
          (value) => Number.isFinite(value) && value >= 0,
        )
      ) {
        throw new Error(
          "The selected shipping price is invalid. Refresh prices and choose the service again.",
        );
      }
      const shipmentOperationKey = `${operationKey}:${entry.order.id}`;
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ shipment: entry.requested, service, customs: entry.customs }))
        .digest("hex");
      const providerReference = `${entry.order.so_number}-${operationKey.slice(0, 24)}`;
      const [insert] = await connection.execute<ResultSetHeader>(
        `INSERT IGNORE INTO ims_shipping_shipments
           (business_id, operation_key, request_hash, so_id, carrier_account_id, dispatch_location_id,
            provider, status, provider_reference, service_code, service_name, quoted_cost,
            quoted_cost_ex_gst, quoted_gst, sender_json, recipient_json, is_international,
            export_purpose, declared_currency, customs_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.businessId,
          shipmentOperationKey,
          requestHash,
          entry.order.id,
          input.carrierAccountId,
          entry.dispatchLocationId,
          account.provider,
          providerReference,
          service?.serviceCode.trim() ?? null,
          service?.serviceName.trim() ?? null,
          service?.total ?? null,
          service?.totalExGst ?? null,
          service?.gst ?? null,
          JSON.stringify(entry.sender),
          JSON.stringify(entry.recipient),
          entry.isInternational ? 1 : 0,
          entry.customs?.exportPurpose ?? null,
          entry.customs?.declaredCurrency ?? null,
          entry.customs ? JSON.stringify(entry.customs) : null,
        ],
      );
      let shipmentId = Number(insert.insertId);
      if (!shipmentId) {
        const [existing] = await connection.execute<RowDataPacket[]>(
          `SELECT id, request_hash FROM ims_shipping_shipments
            WHERE business_id = ? AND operation_key = ? FOR UPDATE`,
          [input.businessId, shipmentOperationKey],
        );
        if (!existing[0] || existing[0].request_hash !== requestHash)
          throw new Error(
            "This shipping operation key was already used with different parcels.",
          );
        shipmentId = Number(existing[0].id);
        result.push({ soId: entry.order.id, shipmentId });
        continue;
      }
      await connection.execute(
        `INSERT INTO ims_shipping_batch_memberships (business_id, shipment_id, batch_key, revision)
         VALUES (?, ?, ?, 1)`,
        [input.businessId, shipmentId, input.preparationOnly ? null : input.batchId ?? operationKey],
      );
      for (const parcel of entry.requested.parcels) {
        const [parcelInsert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO ims_shipping_parcels
             (business_id, shipment_id, package_preset_id, parcel_number, package_type,
              length_mm, width_mm, height_mm, weight_kg)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.businessId,
            shipmentId,
            parcel.packagePresetId ?? null,
            parcel.parcelNumber,
            parcel.packageType || "box",
            parcel.lengthMm,
            parcel.widthMm,
            parcel.heightMm,
            parcel.weightKg,
          ],
        );
        for (const allocation of parcel.allocations) {
          await connection.execute(
            `INSERT INTO ims_shipping_parcel_items (business_id, parcel_id, so_item_id, quantity)
             VALUES (?, ?, ?, ?)`,
            [
              input.businessId,
              parcelInsert.insertId,
              allocation.soItemId,
              allocation.quantity,
            ],
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

export async function prepareShippingRequest(
  input: ShippingRequestInput,
): Promise<PreparedShippingRequest> {
  const deferredCarrier = input.preparationOnly === true && input.carrierAccountId === null;
  if (!deferredCarrier && (input.carrierAccountId === null || !Number.isInteger(input.carrierAccountId) || input.carrierAccountId <= 0))
    throw new ShippingBatchError("Choose a carrier account.", 400);
  if (!input.shipments.length)
    throw new ShippingBatchError("Choose at least one sales order.", 400);

  const accountRows = deferredCarrier ? [] : await queryRows<
    RowDataPacket & {
      id: number;
      provider: string;
      dispatch_location_id: number | null;
    }
  >(
    `SELECT id, provider, dispatch_location_id FROM ims_shipping_carrier_accounts
      WHERE business_id = ? AND id = ? AND is_active = 1 LIMIT 1`,
    [input.businessId, input.carrierAccountId],
  );
  const accountRow = accountRows[0];
  if (!deferredCarrier && !accountRow) throw new ShippingBatchError("Active carrier account not found.", 400);

  const entries: PreparedShippingRequest["entries"] = [];
  for (const requested of input.shipments) {
    const order = await ImsSORepo.get(Number(requested.soId), input.businessId);
    if (!order?.items)
      throw new ShippingBatchError(`Sales order ${requested.soId} was not found.`, 400);
    const remainingQuantity = order.items.reduce(
      (sum, item) =>
        sum +
        Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled)),
      0,
    );
    const typedOrder = order as typeof order & {
      so_type?: string | null;
      channel_delivery_type?: string | null;
    };
    const eligibility = getShippingOrderEligibility({
      status: order.status,
      soType: typedOrder.so_type,
      channelDeliveryType: typedOrder.channel_delivery_type,
      remainingQuantity,
    });
    if (!eligibility.eligible)
      throw new ShippingBatchError(`${order.so_number}: ${eligibility.reason}`, 400);
    const lines = order.items.map((item) => ({
      soItemId: Number(item.id),
      remainingQuantity: Math.max(
        0,
        Number(item.qty_ordered) - Number(item.qty_fulfilled),
      ),
    }));
    const parcelErrors = validateShippingParcels(lines, requested.parcels);
    if (parcelErrors.length)
      throw new ShippingBatchError(`${order.so_number}: ${parcelErrors[0]}`, 400);
    const dispatchLocationId = Number(
      accountRow?.dispatch_location_id ?? order.location_id,
    );
    if (!Number.isInteger(dispatchLocationId) || dispatchLocationId <= 0)
      throw new ShippingBatchError(`${order.so_number}: dispatch location is required.`, 400);
    const location = await ImsLocationsRepo.get(
      dispatchLocationId,
      input.businessId,
    );
    if (!location)
      throw new ShippingBatchError(`${order.so_number}: dispatch location not found.`, 400);
    const sender = {
      name: location.name,
      lines: [location.address].filter((line): line is string => Boolean(line)),
      suburb: location.city || "",
      state: location.state || "",
      postcode: location.postcode || "",
      country: location.country || "AU",
      phone: location.phone || "",
    };
    const recipient = requested.recipient ? validateShippingRecipient(requested.recipient) : {
      name: order.customer_name || order.so_number,
      lines: [order.delivery_address, order.delivery_address2].filter(
        (line): line is string => Boolean(line),
      ),
      suburb: order.delivery_suburb || order.delivery_city || "",
      state: order.delivery_state || "",
      postcode: order.delivery_postcode || "",
      country: order.delivery_country || "",
      email: order.customer_email || "",
      phone: order.customer_phone || "",
    };
    if (isPlaceholderShippingCustomerName(recipient.name)) {
      const customer = await resolveShippingOrderCustomerName(input.businessId, Number(order.id), recipient.name);
      if (customer.name) recipient.name = customer.name;
      else if (!input.preparationOnly)
        throw new ShippingBatchError(`${order.so_number}: ${customer.issue} Enter the actual delivery recipient before buying labels.`, 400);
    }
    if (!recipient.country.trim())
      throw new ShippingBatchError(`${order.so_number}: destination country is required.`, 400);
    const isInternational = !isAustralianShippingCountry(recipient.country);
    const destinationCountry = isInternational
      ? normalizeIsoAlpha2(recipient.country)
      : "AU";
    if (!destinationCountry)
      throw new ShippingBatchError(
        `${order.so_number}: destination country must be an ISO alpha-2 country code.`,
        400,
      );
    recipient.country = destinationCountry;
    const missingSenderFields = [
      !sender.lines.length ? "street address" : "",
      !sender.suburb ? "suburb/city" : "",
      !sender.state ? "state" : "",
      !sender.postcode ? "postcode" : "",
    ].filter(Boolean);
    if (missingSenderFields.length)
      throw new ShippingBatchError(
        `${order.so_number}: dispatch location ${location.name} is missing ${missingSenderFields.join(", ")}.`,
        400,
      );
    if (isInternational) {
      const recipientErrors = getInternationalRecipientErrors({
        ...recipient,
        name: recipient.name,
      });
      if (recipientErrors.length)
        throw new ShippingBatchError(`${order.so_number}: ${recipientErrors.join(", ")}.`, 400);
    } else if (
      !recipient.lines.length ||
      !recipient.suburb ||
      !recipient.state ||
      !recipient.postcode
    ) {
      throw new ShippingBatchError(`${order.so_number}: delivery address is incomplete.`, 400);
    }

    let customs: Readonly<CustomsSnapshot> | null = null;
    if (isInternational) {
      const customsResult = buildCustomsSnapshot({
        exportPurpose: requested.exportPurpose as ShippingExportPurpose,
        lines: order.items.map((item) => ({
          soItemId: Number(item.id),
          productId: item.product_id ? String(item.product_id) : null,
          sku: String(item.sku ?? item.code ?? ""),
          description: item.customs_description ?? null,
          hsCode: item.hs_code ?? null,
          countryOfOrigin: item.country_of_origin ?? null,
          isDangerousOrRestricted: Boolean(item.is_dangerous_or_restricted),
          unitWeightKg: item.weight_kg == null ? null : Number(item.weight_kg),
          unitPrice: Number(item.unit_price),
          discountPct: Number(item.discount_pct ?? 0),
          taxRate: Number(item.tax_rate ?? 0),
          taxTreatment: order.tax_treatment ?? "ex_tax",
        })),
        parcels: requested.parcels,
        nonSaleValues: requested.nonSaleValues,
        nonSaleValuesConfirmed: requested.nonSaleValuesConfirmed,
      });
      if (!customsResult.ok)
        throw new ShippingBatchError(`${order.so_number}: ${customsResult.errors.join(" ")}`, 400);
      customs = customsResult.snapshot;
    }
    entries.push({
      requested,
      order,
      dispatchLocationId,
      sender,
      recipient,
      isInternational,
      customs,
    });
  }
  return {
    account: {
      id: accountRow ? Number(accountRow.id) : null,
      provider: accountRow ? accountRow.provider : "unassigned",
      dispatchLocationId: accountRow?.dispatch_location_id ?? null,
    },
    entries,
  };
}

export function validateShippingRecipient(value: ShippingAmendmentRecipient): ShippingAmendmentRecipient {
  if (!value || !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 2)
    throw new ShippingBatchError("Delivery address requires one or two street address lines.", 400);
  if (value.lines.some(line => typeof line !== "string"))
    throw new ShippingBatchError("Delivery street address lines are invalid.", 400);
  const result = { ...value, lines: value.lines.map(line => line.trim()) };
  for (const field of ["name", "suburb", "state", "postcode", "country", "email", "phone"] as const) {
    if (typeof value[field] !== "string") throw new ShippingBatchError(`Delivery ${field} is invalid.`, 400);
    result[field] = value[field].trim();
  }
  if (!result.name || !result.suburb || result.lines.some(line => !line))
    throw new ShippingBatchError("Delivery name, street address and suburb are required.", 400);
  if (result.name.length > 35 || result.lines.some(line => line.length > 40) ||
      result.suburb.length > 35 || result.state.length > 40 || result.postcode.length > 20 ||
      result.email.length > 50 || result.phone.length > 20)
    throw new ShippingBatchError("Delivery address exceeds the carrier field limits.", 400);
  const country = isAustralianShippingCountry(result.country) ? "AU" : normalizeIsoAlpha2(result.country);
  if (!country) throw new Error("Destination country must be an ISO alpha-2 country code.");
  result.country = country;
  if (country === "AU" && (!/^(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/.test(result.state) || !/^\d{4}$/.test(result.postcode)))
    throw new Error("A valid Australian state and four-digit postcode are required.");
  return result;
}

async function queryRows<T extends RowDataPacket>(
  sql: string,
  params: Array<string | number | null>,
): Promise<T[]> {
  const connection = await getIMSPool().getConnection();
  try {
    const [rows] = await connection.execute<RowDataPacket[]>(sql, params);
    return rows as T[];
  } finally {
    connection.release();
  }
}
import { isPlaceholderShippingCustomerName, resolveShippingOrderCustomerName } from "./shippingCustomerNames";
