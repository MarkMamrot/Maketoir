import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { getAmazonChannelAccess } from '@/lib/channels/amazonCredentials';
import { confirmAmazonShipment, type AmazonShipmentConfirmation } from '@/lib/channels/amazonSpApi';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { recomputeBuildRequirementsSafely } from '@/lib/ims/builds/buildRequirementService';
import { fulfilSalesOrderPartialInTransaction } from '@/lib/ims/orderResolution/customerFulfilment';
import { triggerSOXeroSync } from '@/lib/ims/xeroHooks';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool, imsExecute, imsQuery } from '@/services/IMSMySQLService';

type DispatchRow = {
  id: number; so_id: number; status: string; ims_fulfilment_operation_key: string | null;
  sales_channel: string | null; channel_instance_id: string | null; external_order_id: string | null;
  shopify_order_id: string | null; so_status: string;
};

export type ShippingDispatchResult = {
  shipmentId: number;
  soId: number;
  orderStatus: string;
  shipmentStatus: 'complete' | 'channel_pending';
  warning?: string;
};

export type AmazonShipmentParcelRow = {
  parcelId: string;
  provider: string;
  carrierName: string;
  serviceName: string | null;
  articleId: string | null;
  consignmentId: string | null;
  externalOrderItemId: string | null;
  quantity: number;
};

export function buildAmazonShipmentConfirmations(
  rows: AmazonShipmentParcelRow[],
  shipDate: string,
): Array<{ parcelId: string; confirmation: AmazonShipmentConfirmation }> {
  const packages = new Map<string, { rows: AmazonShipmentParcelRow[] }>();
  for (const row of rows) {
    const parcelId = String(row.parcelId ?? '').trim();
    if (!/^[1-9]\d*$/.test(parcelId)) throw new Error('Amazon package reference ID must be a positive numeric value.');
    const current = packages.get(parcelId) ?? { rows: [] };
    current.rows.push(row);
    packages.set(parcelId, current);
  }
  if (!packages.size) throw new Error('Amazon shipment has no parcels to confirm.');
  return [...packages].map(([parcelId, entry]) => {
    const first = entry.rows[0];
    const trackingNumber = String(first.articleId || first.consignmentId || '').trim();
    if (!trackingNumber) throw new Error('Carrier tracking numbers are not available for this Amazon shipment.');
    const quantities = new Map<string, number>();
    for (const row of entry.rows) {
      const orderItemId = String(row.externalOrderItemId ?? '').trim();
      const quantity = Number(row.quantity);
      if (!orderItemId) throw new Error('A dispatched line is not mapped to an Amazon order item.');
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Amazon shipment item quantity must be a positive integer.');
      quantities.set(orderItemId, (quantities.get(orderItemId) ?? 0) + quantity);
    }
    const isAustraliaPost = first.provider === 'auspost_eparcel';
    const carrierName = isAustraliaPost ? 'Australia Post' : String(first.carrierName || first.provider || '').trim();
    return {
      parcelId,
      confirmation: {
        packageReferenceId: parcelId,
        carrierCode: isAustraliaPost ? 'Australia Post' : 'Other',
        ...(carrierName ? { carrierName } : {}),
        ...(first.serviceName ? { shippingMethod: first.serviceName } : {}),
        trackingNumber,
        shipDate,
        orderItems: [...quantities].map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
      },
    };
  });
}

export async function dispatchShippingShipment(input: { businessId: string; shipmentId: number }): Promise<ShippingDispatchResult> {
  const connection = await getIMSPool().getConnection();
  let row: DispatchRow | null = null;
  let fulfilledVariantIds: string[] = [];
  let orderStatus = '';
  let didFulfil = false;
  let didFinalize = false;
  try {
    await connection.beginTransaction();
    const [[shipment]] = await connection.execute<any[]>(
      `SELECT shipping.id, shipping.so_id, shipping.status, shipping.ims_fulfilment_operation_key,
              sales_order.sales_channel, sales_order.channel_instance_id, sales_order.external_order_id,
              sales_order.shopify_order_id, sales_order.status AS so_status
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
      const needsAmazon = row.sales_channel === 'amazon';
      const needsChannel = needsShopify || needsAmazon;
      let amazonPackages: Array<{ parcelId: string; confirmation: AmazonShipmentConfirmation }> = [];
      if (needsAmazon) {
        if (!row.channel_instance_id || !row.external_order_id) {
          throw new Error('The Amazon seller instance or order ID is missing.');
        }
        const [packageRows] = await connection.execute<any[]>(
          `SELECT CAST(parcel.id AS CHAR) AS parcelId, shipping.provider,
                  carrier.display_name AS carrierName, shipping.service_name AS serviceName,
                  parcel.article_id AS articleId, parcel.consignment_id AS consignmentId,
                  order_item.external_order_item_id AS externalOrderItemId, parcel_item.quantity
             FROM ims_shipping_parcels parcel
             JOIN ims_shipping_shipments shipping
               ON shipping.id = parcel.shipment_id AND shipping.business_id = parcel.business_id
             JOIN ims_shipping_carrier_accounts carrier
               ON carrier.id = shipping.carrier_account_id AND carrier.business_id = shipping.business_id
             JOIN ims_shipping_parcel_items parcel_item
               ON parcel_item.parcel_id = parcel.id AND parcel_item.business_id = parcel.business_id
             JOIN ims_sales_order_items order_item
               ON order_item.id = parcel_item.so_item_id AND order_item.business_id = parcel_item.business_id
            WHERE parcel.business_id = ? AND parcel.shipment_id = ?
            ORDER BY parcel.parcel_number, parcel_item.id`,
          [input.businessId, row.id],
        );
        amazonPackages = buildAmazonShipmentConfirmations(packageRows.map(packageRow => ({
          ...packageRow,
          quantity: Number(packageRow.quantity),
        })), new Date().toISOString());
      }
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
          finalizeWhenComplete: true,
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
        [needsChannel ? 'channel_pending' : 'complete', didFulfil ? operationKey : row.ims_fulfilment_operation_key,
          needsChannel ? 'channel_pending' : 'complete', input.businessId, row.id],
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
      if (needsAmazon) {
        for (const packageRequest of amazonPackages) {
          await connection.execute(
            `INSERT INTO ims_shipping_channel_jobs
               (business_id, shipment_id, sales_channel, operation_key, status, request_json)
             VALUES (?, ?, 'amazon', ?, 'pending', ?)
             ON DUPLICATE KEY UPDATE shipment_id = VALUES(shipment_id),
               status = IF(status = 'complete', status, 'pending'), next_attempt_at = NULL, safe_error = NULL`,
            [input.businessId, row.id, `shipping-channel:${row.id}:amazon:${packageRequest.parcelId}`, JSON.stringify({
              shipmentId: row.id,
              channelInstanceId: row.channel_instance_id,
              amazonOrderId: row.external_order_id,
              confirmation: packageRequest.confirmation,
            })],
          );
        }
      }
    } else {
      orderStatus = row.so_status;
      if (orderStatus === 'partially_fulfilled') {
        const [outstanding] = await connection.execute<any[]>(
          `SELECT id FROM ims_sales_order_items
            WHERE so_id = ? AND qty_fulfilled < qty_ordered
            FOR UPDATE`,
          [row.so_id],
        );
        if (outstanding.length === 0) {
          await connection.execute(
            `UPDATE ims_sales_orders
                SET status = 'fulfilled', fulfilled_date = COALESCE(fulfilled_date, CURDATE())
              WHERE id = ? AND business_id = ? AND status = 'partially_fulfilled'`,
            [row.so_id, input.businessId],
          );
          orderStatus = 'fulfilled';
          didFinalize = true;
        }
      }
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
  if (didFinalize) await triggerSOXeroSync(input.businessId, row.so_id, 'fulfilled');
  const channel = row.sales_channel === 'amazon'
    ? 'amazon'
    : row.sales_channel === 'shopify' || row.shopify_order_id ? 'shopify' : null;
  if (!channel) {
    return { shipmentId: row.id, soId: row.so_id, orderStatus, shipmentStatus: 'complete' };
  }

  try {
    if (channel === 'amazon') {
      await confirmAmazonShipmentJobs(input.businessId, row.id);
    } else {
      await createShopifyFulfilment(input.businessId, row.id, row.shopify_order_id);
    }
    await imsExecute(
      `UPDATE ims_shipping_shipments SET status = 'complete', completed_at = NOW(), safe_error = NULL
        WHERE business_id = ? AND id = ? AND status = 'channel_pending'`,
      [input.businessId, row.id],
    );
    if (channel === 'shopify') {
      await imsExecute(
        `UPDATE ims_shipping_channel_jobs SET status = 'complete', attempt_count = attempt_count + 1,
            response_json = ?, safe_error = NULL, completed_at = NOW()
          WHERE business_id = ? AND operation_key = ?`,
        [JSON.stringify({ syncedAt: new Date().toISOString() }), input.businessId, `shipping-channel:${row.id}`],
      );
    }
    return { shipmentId: row.id, soId: row.so_id, orderStatus, shipmentStatus: 'complete' };
  } catch (error) {
    const safeError = (error instanceof Error ? error.message : `${channel === 'amazon' ? 'Amazon' : 'Shopify'} fulfillment sync failed.`).slice(0, 500);
    await imsExecute(
      `UPDATE ims_shipping_shipments SET status = 'channel_pending', safe_error = ? WHERE business_id = ? AND id = ?`,
      [safeError, input.businessId, row.id],
    );
    if (channel === 'shopify') {
      await imsExecute(
        `UPDATE ims_shipping_channel_jobs SET status = 'failed', attempt_count = attempt_count + 1,
            next_attempt_at = DATE_ADD(NOW(), INTERVAL 15 MINUTE), safe_error = ?
          WHERE business_id = ? AND operation_key = ?`,
        [safeError, input.businessId, `shipping-channel:${row.id}`],
      );
    }
    await reportRuntimeIssue({
      businessId: input.businessId, source: 'ims_shipping', operation: `${channel}_fulfilment`,
      title: `Dispatched shipment could not sync fulfillment to ${channel === 'amazon' ? 'Amazon' : 'Shopify'}`, error,
      context: { shipmentId: row.id, soId: row.so_id, channelInstanceId: row.channel_instance_id },
      reference: { type: 'sales_order', id: String(row.so_id) },
    });
    return { shipmentId: row.id, soId: row.so_id, orderStatus, shipmentStatus: 'channel_pending', warning: safeError };
  }
}

type AmazonShipmentJobRequest = {
  channelInstanceId: string;
  amazonOrderId: string;
  confirmation: AmazonShipmentConfirmation;
};

const AMAZON_SHIPMENT_MAX_ATTEMPTS = 5;

export async function confirmAmazonShipmentJobs(businessId: string, shipmentId: number): Promise<void> {
  const jobs = await imsQuery<{ id: number; request_json: AmazonShipmentJobRequest | string }>(
    `SELECT id, request_json
       FROM ims_shipping_channel_jobs
      WHERE business_id = ? AND shipment_id = ? AND sales_channel = 'amazon' AND status <> 'complete'
      ORDER BY id`,
    [businessId, shipmentId],
  );
  if (!jobs.length) {
    const completed = await imsQuery<{ id: number }>(
      `SELECT id FROM ims_shipping_channel_jobs
        WHERE business_id = ? AND shipment_id = ? AND sales_channel = 'amazon' AND status = 'complete' LIMIT 1`,
      [businessId, shipmentId],
    );
    if (!completed.length) throw new Error('Amazon shipment confirmation jobs are missing.');
    return;
  }
  const requests = jobs.map(job => ({
    jobId: job.id,
    request: (typeof job.request_json === 'string' ? JSON.parse(job.request_json) : job.request_json) as AmazonShipmentJobRequest,
  }));
  const channelInstanceId = String(requests[0]?.request.channelInstanceId ?? '').trim();
  if (!channelInstanceId || requests.some(job => job.request.channelInstanceId !== channelInstanceId)) {
    throw new Error('Amazon shipment confirmation seller identity is invalid.');
  }
  const access = await getAmazonChannelAccess(businessId, channelInstanceId);
  if (!access) throw new Error('Amazon channel credentials are unavailable.');
  for (const job of requests) {
    try {
      await confirmAmazonShipment(access.accessToken, job.request.amazonOrderId, job.request.confirmation);
      await imsExecute(
        `UPDATE ims_shipping_channel_jobs
            SET status = 'complete', attempt_count = attempt_count + 1, response_json = ?,
                safe_error = NULL, next_attempt_at = NULL, completed_at = NOW()
          WHERE business_id = ? AND id = ? AND status <> 'complete'`,
        [JSON.stringify({ syncedAt: new Date().toISOString() }), businessId, job.jobId],
      );
    } catch (error) {
      const safeError = (error instanceof Error ? error.message : 'Amazon shipment confirmation failed.').slice(0, 500);
      await imsExecute(
        `UPDATE ims_shipping_channel_jobs
            SET status = 'failed', attempt_count = attempt_count + 1,
                next_attempt_at = CASE WHEN attempt_count + 1 >= ? THEN NULL ELSE DATE_ADD(NOW(), INTERVAL 15 MINUTE) END,
                safe_error = ?
          WHERE business_id = ? AND id = ? AND status <> 'complete'`,
        [AMAZON_SHIPMENT_MAX_ATTEMPTS, safeError, businessId, job.jobId],
      );
      throw error;
    }
  }
}

export async function retryAmazonShipmentConfirmationsForChannel(input: {
  businessId: string;
  channelInstanceId: string;
  limit?: number;
}): Promise<{ attempted: number; completed: number; failed: number }> {
  const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 20)));
  return runImsForBusiness(input.businessId, async () => {
    const shipments = await imsQuery<{ shipment_id: number }>(
      `SELECT job.shipment_id
         FROM ims_shipping_channel_jobs job
         JOIN ims_shipping_shipments shipment
           ON shipment.id = job.shipment_id AND shipment.business_id = job.business_id
         JOIN ims_sales_orders sales_order
           ON sales_order.id = shipment.so_id AND sales_order.business_id = shipment.business_id
        WHERE job.business_id = ? AND job.sales_channel = 'amazon'
          AND job.status IN ('pending', 'failed')
          AND job.attempt_count < ?
          AND (job.next_attempt_at IS NULL OR job.next_attempt_at <= NOW())
          AND sales_order.channel_instance_id = ?
        GROUP BY job.shipment_id
        ORDER BY MIN(job.id)
        LIMIT ?`,
      [input.businessId, AMAZON_SHIPMENT_MAX_ATTEMPTS, input.channelInstanceId, limit],
    );
    const totals = { attempted: shipments.length, completed: 0, failed: 0 };
    for (const shipment of shipments) {
      const result = await dispatchShippingShipment({ businessId: input.businessId, shipmentId: Number(shipment.shipment_id) });
      if (result.shipmentStatus === 'complete') totals.completed += 1;
      else totals.failed += 1;
    }
    return totals;
  });
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
      query: `query ShippingFulfillmentOrders($id: ID!) { order(id: $id) { fulfillmentOrders(first: 50) { nodes { id status lineItems(first: 250) { nodes { id remainingQuantity lineItem { id } } } } } } }`,
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
      const lineId = shopifyNumericId(item?.lineItem?.id);
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
  if (messages.some(message => /access denied for fulfillmentOrders field/i.test(message))) {
    return 'Shopify fulfillment permissions are missing. Grant read_merchant_managed_fulfillment_orders and write_merchant_managed_fulfillment_orders, then refresh the Shopify access token in Setup > Connections.';
  }
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

export function shopifyNumericId(value: unknown): string {
  const id = String(value ?? '').trim();
  return id.startsWith('gid://') ? id.slice(id.lastIndexOf('/') + 1) : id;
}