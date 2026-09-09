import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { recomputeBuildRequirementsSafely } from '@/lib/ims/builds/buildRequirementService';
import { fulfilSalesOrderPartialInTransaction } from '@/lib/ims/orderResolution/customerFulfilment';
import { triggerSOXeroSync } from '@/lib/ims/xeroHooks';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool, imsExecute, imsQuery } from '@/services/IMSMySQLService';

type DispatchRow = {
  id: number; so_id: number; status: string; ims_fulfilment_operation_key: string | null;
  sales_channel: string | null; shopify_order_id: string | null; so_status: string;
};

export type ShippingDispatchResult = {
  shipmentId: number;
  soId: number;
  orderStatus: string;
  shipmentStatus: 'complete' | 'channel_pending';
  warning?: string;
};

export async function dispatchShippingShipment(input: { businessId: string; shipmentId: number }): Promise<ShippingDispatchResult> {
  const connection = await getIMSPool().getConnection();
  let row: DispatchRow | null = null;
  let fulfilledVariantIds: string[] = [];
  let orderStatus = '';
  let didFulfil = false;
  try {
    await connection.beginTransaction();
    const [[shipment]] = await connection.execute<any[]>(
      `SELECT shipping.id, shipping.so_id, shipping.status, shipping.ims_fulfilment_operation_key,
              sales_order.sales_channel, sales_order.shopify_order_id, sales_order.status AS so_status
         FROM ims_shipping_shipments shipping
         JOIN ims_sales_orders sales_order
           ON sales_order.id = shipping.so_id AND sales_order.business_id = shipping.business_id
        WHERE shipping.business_id = ? AND shipping.id = ? FOR UPDATE`,
      [input.businessId, input.shipmentId],
    );
    row = shipment ?? null;
    if (!row) throw new Error('Prepared shipment was not found.');
    if (row.status === 'complete') {
      await connection.commit();
      return { shipmentId: row.id, soId: row.so_id, orderStatus: row.so_status, shipmentStatus: 'complete' };
    }
    if (!['label_ready', 'ims_fulfilled', 'channel_pending'].includes(row.status)) {
      throw new Error('A shipment can be marked dispatched only after its label is ready.');
    }

    if (row.status === 'label_ready') {
      const [allocations] = await connection.execute<any[]>(
        `SELECT parcel_item.so_item_id AS item_id, SUM(parcel_item.quantity) AS quantity
           FROM ims_shipping_parcel_items parcel_item
           JOIN ims_shipping_parcels parcel
             ON parcel.id = parcel_item.parcel_id AND parcel.business_id = parcel_item.business_id
          WHERE parcel.business_id = ? AND parcel.shipment_id = ?
          GROUP BY parcel_item.so_item_id`,
        [input.businessId, row.id],
      );
      const operationKey = row.ims_fulfilment_operation_key || `shipping-dispatch:${row.id}`;
      const needsShopify = row.sales_channel === 'shopify' || Boolean(row.shopify_order_id);
      if (row.so_status === 'fulfilled' && needsShopify) {
        const [[existingShopifyFulfilment]] = await connection.execute<any[]>(
          `SELECT id FROM ims_so_shipments
            WHERE business_id = ? AND so_id = ? AND shopify_fulfilment_id <> ''
            ORDER BY COALESCE(fulfilled_at, created_at) DESC, id DESC LIMIT 1`,
          [input.businessId, row.so_id],
        );
        if (!existingShopifyFulfilment) {
          throw new Error('This order is already fulfilled, but its Shopify fulfillment could not be matched.');
        }
        orderStatus = row.so_status;
      } else {
        const fulfilment = await fulfilSalesOrderPartialInTransaction(connection, {
          businessId: input.businessId,
          soId: row.so_id,
          operationKey,
          shipmentQuantities: allocations.map(allocation => ({ itemId: Number(allocation.item_id), quantity: Number(allocation.quantity) })),
        });
        fulfilledVariantIds = fulfilment.fulfilledVariantIds;
        orderStatus = fulfilment.status;
        didFulfil = true;
      }
      await connection.execute(
        `UPDATE ims_shipping_shipments
            SET status = ?, ims_fulfilment_operation_key = ?, ims_fulfilled_at = NOW(),
                completed_at = CASE WHEN ? = 'complete' THEN NOW() ELSE completed_at END, safe_error = NULL
          WHERE business_id = ? AND id = ?`,
        [needsShopify ? 'channel_pending' : 'complete', operationKey, needsShopify ? 'channel_pending' : 'complete', input.businessId, row.id],
      );
      if (needsShopify) {
        await connection.execute(
          `INSERT INTO ims_shipping_channel_jobs
             (business_id, shipment_id, sales_channel, operation_key, status, request_json)
           VALUES (?, ?, 'shopify', ?, 'pending', ?)
           ON DUPLICATE KEY UPDATE shipment_id = VALUES(shipment_id), status = IF(status = 'complete', status, 'pending'),
             next_attempt_at = NULL, safe_error = NULL`,
          [input.businessId, row.id, `shipping-channel:${row.id}`, JSON.stringify({ shipmentId: row.id, shopifyOrderId: row.shopify_order_id })],
        );
      }
    } else {
      orderStatus = row.so_status;
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  if (!row) throw new Error('Prepared shipment was not found.');
  if (didFulfil) {
    if (fulfilledVariantIds.length) refreshVariantCache(fulfilledVariantIds).catch(() => undefined);
    if (orderStatus === 'fulfilled') await triggerSOXeroSync(input.businessId, row.so_id, 'fulfilled');
    await recomputeBuildRequirementsSafely({ businessId: input.businessId, salesOrderId: row.so_id });
  }
  if (row.sales_channel !== 'shopify' && !row.shopify_order_id) {
    return { shipmentId: row.id, soId: row.so_id, orderStatus, shipmentStatus: 'complete' };
  }

  try {
    await createShopifyFulfilment(input.businessId, row.id, row.shopify_order_id);
    await imsExecute(
      `UPDATE ims_shipping_shipments SET status = 'complete', completed_at = NOW(), safe_error = NULL
        WHERE business_id = ? AND id = ? AND status = 'channel_pending'`,
      [input.businessId, row.id],
    );
    await imsExecute(
      `UPDATE ims_shipping_channel_jobs SET status = 'complete', attempt_count = attempt_count + 1,
          response_json = ?, safe_error = NULL, completed_at = NOW()
        WHERE business_id = ? AND operation_key = ?`,
      [JSON.stringify({ syncedAt: new Date().toISOString() }), input.businessId, `shipping-channel:${row.id}`],
    );
    return { shipmentId: row.id, soId: row.so_id, orderStatus, shipmentStatus: 'complete' };
  } catch (error) {
    const safeError = (error instanceof Error ? error.message : 'Shopify fulfillment sync failed.').slice(0, 500);
    await imsExecute(
      `UPDATE ims_shipping_shipments SET status = 'channel_pending', safe_error = ? WHERE business_id = ? AND id = ?`,
      [safeError, input.businessId, row.id],
    );
    await imsExecute(
      `UPDATE ims_shipping_channel_jobs SET status = 'failed', attempt_count = attempt_count + 1,
          next_attempt_at = DATE_ADD(NOW(), INTERVAL 15 MINUTE), safe_error = ?
        WHERE business_id = ? AND operation_key = ?`,
      [safeError, input.businessId, `shipping-channel:${row.id}`],
    );
    await reportRuntimeIssue({
      businessId: input.businessId, source: 'ims_shipping', operation: 'shopify_fulfilment',
      title: 'Dispatched shipment could not sync fulfillment to Shopify', error,
      context: { shipmentId: row.id, soId: row.so_id },
      reference: { type: 'sales_order', id: String(row.so_id) },
    });
    return { shipmentId: row.id, soId: row.so_id, orderStatus, shipmentStatus: 'channel_pending', warning: safeError };
  }
}

async function createShopifyFulfilment(businessId: string, shipmentId: number, shopifyOrderId: string | null): Promise<void> {
  if (!shopifyOrderId) throw new Error('The Shopify order ID is missing.');
  const credentials = await getShopifyAdminCredentials(businessId);
  if (!credentials) throw new Error('Shopify credentials are unavailable.');
  const lines = await imsQuery<{ so_id: number; shopify_line_item_id: string | null; quantity: number }>(
    `SELECT MAX(order_item.so_id) AS so_id, order_item.shopify_line_item_id, SUM(parcel_item.quantity) AS quantity
       FROM ims_shipping_parcel_items parcel_item
       JOIN ims_shipping_parcels parcel ON parcel.id = parcel_item.parcel_id AND parcel.business_id = parcel_item.business_id
       JOIN ims_sales_order_items order_item ON order_item.id = parcel_item.so_item_id AND order_item.business_id = parcel_item.business_id
      WHERE parcel.business_id = ? AND parcel.shipment_id = ?
      GROUP BY order_item.shopify_line_item_id`,
    [businessId, shipmentId],
  );
  if (lines.some(line => !line.shopify_line_item_id)) throw new Error('A dispatched line is not mapped to a Shopify order line.');
  const trackingRows = await imsQuery<{ provider: string; article_id: string | null; consignment_id: string | null; tracking_url: string | null }>(
    `SELECT shipment.provider, parcel.article_id, parcel.consignment_id, parcel.tracking_url
       FROM ims_shipping_parcels parcel
       JOIN ims_shipping_shipments shipment
         ON shipment.id = parcel.shipment_id AND shipment.business_id = parcel.business_id
      WHERE parcel.business_id = ? AND parcel.shipment_id = ? ORDER BY parcel.parcel_number`,
    [businessId, shipmentId],
  );
  const tracking = buildOutboundTracking(trackingRows);
  if (!tracking.numbers.length) throw new Error('Carrier tracking numbers are not available for this dispatched shipment.');
  const endpoint = `https://${credentials.shopDomain}/admin/api/2025-10/graphql.json`;
  const queryResponse = await fetch(endpoint, {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': credentials.token },
    body: JSON.stringify({
      query: `query ShippingFulfillmentOrders($id: ID!) { order(id: $id) { fulfillmentOrders(first: 50) { nodes { id status lineItems(first: 250) { nodes { id remainingQuantity lineItem { legacyResourceId } } } } } } }`,
      variables: { id: `gid://shopify/Order/${shopifyOrderId}` },
    }),
  });
  const queryPayload = await queryResponse.json().catch(() => null) as any;
  if (!queryResponse.ok || queryPayload?.errors?.length) throw new Error(formatShopifyFulfilmentError(queryResponse.status, queryPayload));
  const groups = buildShopifyFulfilmentGroups(lines, queryPayload?.data?.order?.fulfillmentOrders?.nodes ?? []);
  if (!groups.length) {
    const existingRows = await imsQuery<{
      shopify_fulfilment_id: string; shopify_line_item_id: string; quantity: number;
    }>(
      `SELECT shipment.shopify_fulfilment_id, item.shopify_line_item_id, item.quantity
         FROM ims_so_shipments shipment
         JOIN ims_so_shipment_items item
           ON item.shipment_id = shipment.id AND item.business_id = shipment.business_id
        WHERE shipment.business_id = ? AND shipment.so_id = ?
        ORDER BY COALESCE(shipment.fulfilled_at, shipment.created_at) DESC, shipment.id DESC, item.id`,
      [businessId, Number(lines[0]?.so_id)],
    );
    const existingFulfilmentId = findMatchingShopifyFulfilmentId(lines, existingRows);
    if (!existingFulfilmentId) throw new Error('The existing Shopify fulfillment could not be matched to this shipment.');
    const trackingResponse = await fetch(endpoint, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': credentials.token },
      body: JSON.stringify({
        query: `mutation UpdateShippingTracking($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!, $notifyCustomer: Boolean) { fulfillmentTrackingInfoUpdate(fulfillmentId: $fulfillmentId, trackingInfoInput: $trackingInfoInput, notifyCustomer: $notifyCustomer) { fulfillment { id status } userErrors { field message } } }`,
        variables: {
          fulfillmentId: existingFulfilmentId.startsWith('gid://') ? existingFulfilmentId : `gid://shopify/Fulfillment/${existingFulfilmentId}`,
          trackingInfoInput: tracking,
          notifyCustomer: true,
        },
      }),
    });
    const trackingPayload = await trackingResponse.json().catch(() => null) as any;
    const trackingErrors = trackingPayload?.data?.fulfillmentTrackingInfoUpdate?.userErrors ?? [];
    if (!trackingResponse.ok || trackingPayload?.errors?.length || trackingErrors.length) {
      throw new Error(formatShopifyFulfilmentError(trackingResponse.status, trackingPayload, trackingErrors));
    }
    return;
  }
  const mutationResponse = await fetch(endpoint, {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': credentials.token },
    body: JSON.stringify({
      query: `mutation CreateShippingFulfillment($fulfillment: FulfillmentInput!) { fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { field message } } }`,
      variables: { fulfillment: { lineItemsByFulfillmentOrder: groups, notifyCustomer: true, trackingInfo: tracking } },
    }),
  });
  const mutationPayload = await mutationResponse.json().catch(() => null) as any;
  const userErrors = mutationPayload?.data?.fulfillmentCreate?.userErrors ?? [];
  if (!mutationResponse.ok || mutationPayload?.errors?.length || userErrors.length) {
    throw new Error(formatShopifyFulfilmentError(mutationResponse.status, mutationPayload, userErrors));
  }
}

export function buildShopifyFulfilmentGroups(
  lines: Array<{ shopify_line_item_id: string | null; quantity: number }>,
  fulfillmentOrders: any[],
): Array<{ fulfillmentOrderId: string; fulfillmentOrderLineItems: Array<{ id: string; quantity: number }> }> {
  const requested = new Map(lines.map(line => [String(line.shopify_line_item_id), Number(line.quantity)]));
  const seen = new Set<string>();
  const groups = fulfillmentOrders.flatMap((order: any) => {
    const items = (order?.lineItems?.nodes ?? []).flatMap((item: any) => {
      const lineId = String(item?.lineItem?.legacyResourceId ?? '');
      if (!requested.has(lineId)) return [];
      seen.add(lineId);
      const quantity = Math.min(requested.get(lineId) ?? 0, Number(item?.remainingQuantity ?? 0));
      if (quantity <= 0) return [];
      requested.set(lineId, (requested.get(lineId) ?? 0) - quantity);
      return [{ id: String(item.id), quantity }];
    });
    return items.length ? [{ fulfillmentOrderId: String(order.id), fulfillmentOrderLineItems: items }] : [];
  });
  if ([...requested.keys()].some(lineId => !seen.has(lineId))) throw new Error('A dispatched line is not available on a Shopify fulfillment order.');
  if ([...requested.values()].some(quantity => quantity > 0) && groups.length) {
    throw new Error('Shopify does not have enough fulfillable quantity for this shipment.');
  }
  return groups;
}

export function formatShopifyFulfilmentError(status: number, payload: any, userErrors: any[] = []): string {
  const messages = [...(payload?.errors ?? []), ...userErrors].map(error => String(error?.message ?? '')).filter(Boolean);
  return `Shopify fulfillment failed${status ? ` (HTTP ${status})` : ''}${messages.length ? `: ${messages.join('; ')}` : '.'}`;
}

export function buildOutboundTracking(rows: Array<{
  provider: string;
  article_id: string | null;
  consignment_id: string | null;
  tracking_url: string | null;
}>): { company: string; numbers: string[]; urls: string[] } {
  const provider = rows[0]?.provider ?? '';
  const company = provider === 'auspost_eparcel' ? 'Australia Post' : provider || 'Other';
  const seen = new Set<string>();
  const items = rows.flatMap(row => {
    const number = String(row.article_id || row.consignment_id || '').trim();
    if (!number || seen.has(number)) return [];
    seen.add(number);
    const fallbackUrl = row.provider === 'auspost_eparcel'
      ? `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(number)}`
      : '';
    return [{ number, url: String(row.tracking_url || fallbackUrl).trim() }];
  });
  return { company, numbers: items.map(item => item.number), urls: items.map(item => item.url) };
}

export function findMatchingShopifyFulfilmentId(
  requestedLines: Array<{ shopify_line_item_id: string | null; quantity: number }>,
  existingRows: Array<{ shopify_fulfilment_id: string; shopify_line_item_id: string; quantity: number }>,
): string | null {
  const requested = new Map(requestedLines.map(line => [String(line.shopify_line_item_id), Number(line.quantity)]));
  const byFulfilment = new Map<string, Map<string, number>>();
  for (const row of existingRows) {
    const fulfilmentId = String(row.shopify_fulfilment_id || '').trim();
    if (!fulfilmentId) continue;
    const quantities = byFulfilment.get(fulfilmentId) ?? new Map<string, number>();
    const lineId = String(row.shopify_line_item_id);
    quantities.set(lineId, (quantities.get(lineId) ?? 0) + Number(row.quantity));
    byFulfilment.set(fulfilmentId, quantities);
  }
  for (const [fulfilmentId, quantities] of byFulfilment) {
    if ([...requested].every(([lineId, quantity]) => (quantities.get(lineId) ?? 0) >= quantity)) return fulfilmentId;
  }
  return null;
}