import { getAmazonChannelAccess } from '@/lib/channels/amazonCredentials';
import { importAmazonOrder } from '@/lib/channels/amazonOrderImport';
import { listAmazonFbmOrders, listAmazonOrderItems, type AmazonOrderItem } from '@/lib/channels/amazonSpApi';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

const DEFAULT_LOOKBACK_HOURS = 24;
const CURSOR_OVERLAP_MINUTES = 5;
const ITEM_PAGE_LIMIT = 10;

function validDate(value: unknown): Date | null {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

function eventId(amazonOrderId: string, lastUpdatedAt: string): string {
  return `${amazonOrderId}:${lastUpdatedAt}`.slice(0, 191);
}

async function loadAllOrderItems(accessToken: string, amazonOrderId: string): Promise<AmazonOrderItem[]> {
  const items: AmazonOrderItem[] = [];
  let nextToken: string | null = null;
  for (let page = 0; page < ITEM_PAGE_LIMIT; page++) {
    const result = await listAmazonOrderItems(accessToken, amazonOrderId, nextToken);
    items.push(...result.items);
    nextToken = result.nextToken;
    if (!nextToken) return items;
  }
  throw new Error(`Amazon order ${amazonOrderId} returned too many item pages.`);
}

export async function syncAmazonOrdersForChannel(input: {
  businessId: string;
  channelInstanceId: string;
  limit?: number;
  now?: Date;
}): Promise<{ scanned: number; imported: number; updated: number; skipped: number; failed: number; hasMore: boolean }> {
  const instance = await SalesChannelInstanceRepository.getForBusiness(input.businessId, input.channelInstanceId);
  if (!instance || instance.provider !== 'amazon') throw new Error('Amazon channel not found.');
  const locationId = Math.floor(Number(instance.settings.orderLocationId ?? 0));
  if (!Number.isInteger(locationId) || locationId <= 0) {
    throw new Error('Choose a dispatch location before synchronizing Amazon orders.');
  }
  const access = await getAmazonChannelAccess(input.businessId, input.channelInstanceId);
  if (!access) throw new Error('Amazon authorization is missing.');
  const now = input.now ?? new Date();
  const continuedAfter = validDate(instance.settings.ordersContinuationAfter);
  const continuedBefore = validDate(instance.settings.ordersContinuationBefore);
  const hasContinuation = Boolean(continuedAfter && continuedBefore && continuedAfter < continuedBefore);
  const before = hasContinuation ? continuedBefore! : new Date(now.getTime() - 2 * 60_000);
  const savedCursor = validDate(instance.settings.ordersLastUpdatedAt);
  const after = hasContinuation ? continuedAfter! : new Date(
    (savedCursor?.getTime() ?? now.getTime() - DEFAULT_LOOKBACK_HOURS * 3_600_000)
      - (savedCursor ? CURSOR_OVERLAP_MINUTES * 60_000 : 0),
  );
  const maxOrders = Math.max(1, Math.min(100, Math.floor(input.limit ?? 25)));

  return runImsForBusiness(input.businessId, async () => {
    const totals = { scanned: 0, imported: 0, updated: 0, skipped: 0, failed: 0, hasMore: false };
    let nextToken = hasContinuation && typeof instance.settings.ordersContinuationToken === 'string'
      ? instance.settings.ordersContinuationToken : null;
    let exhausted = false;
    for (let page = 0; page < 20; page++) {
      const pageToken = nextToken;
      let response;
      try {
        response = await listAmazonFbmOrders(access.accessToken, {
          lastUpdatedAfter: after.toISOString(), lastUpdatedBefore: before.toISOString(), nextToken, pageSize: 100,
        });
      } catch (error) {
        if (hasContinuation) await SalesChannelInstanceRepository.clearAmazonOrderSyncContinuationForBusiness({
          businessId: input.businessId, channelInstanceId: input.channelInstanceId,
        });
        throw error;
      }
      for (const order of response.orders) {
        const externalEventId = eventId(order.AmazonOrderId, order.LastUpdateDate);
        await imsExecute(
          `INSERT INTO ims_sales_channel_events
             (business_id, channel_instance_id, provider, event_type, external_event_id, occurred_at, payload_json)
           VALUES (?, ?, 'amazon', 'order.updated', ?, ?, ?)
           ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
          [input.businessId, input.channelInstanceId, externalEventId, order.LastUpdateDate,
            JSON.stringify({ amazonOrderId: order.AmazonOrderId, orderStatus: order.OrderStatus, lastUpdatedAt: order.LastUpdateDate })],
        );
        const eventRows = await imsQuery<{ id: number; status: string }>(
          `SELECT id, status FROM ims_sales_channel_events
            WHERE business_id = ? AND channel_instance_id = ? AND external_event_id = ? LIMIT 1`,
          [input.businessId, input.channelInstanceId, externalEventId],
        );
        const event = eventRows[0];
        if (!event || event.status === 'complete' || event.status === 'ignored') {
          totals.skipped += 1;
          continue;
        }
        if (totals.scanned >= maxOrders) {
          totals.hasMore = true;
          nextToken = pageToken;
          break;
        }
        totals.scanned += 1;
        await imsExecute(
          `UPDATE ims_sales_channel_events
              SET status = 'processing', attempts = attempts + 1, safe_error = NULL
            WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
          [event.id, input.businessId, input.channelInstanceId],
        );
        try {
          const items = await loadAllOrderItems(access.accessToken, order.AmazonOrderId);
          const result = await importAmazonOrder({
            businessId: input.businessId, channelInstanceId: input.channelInstanceId,
            locationId, order, items,
          });
          totals[result.outcome] += 1;
          await imsExecute(
            `UPDATE ims_sales_channel_events
                SET status = 'complete', processed_at = CURRENT_TIMESTAMP(3), safe_error = NULL
              WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
            [event.id, input.businessId, input.channelInstanceId],
          );
        } catch (error) {
          totals.failed += 1;
          const safeError = (error instanceof Error ? error.message : 'Amazon order import failed.').slice(0, 500);
          await imsExecute(
            `UPDATE ims_sales_channel_events SET status = 'failed', processed_at = CURRENT_TIMESTAMP(3), safe_error = ?
              WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
            [safeError, event.id, input.businessId, input.channelInstanceId],
          );
          await reportRuntimeIssue({
            businessId: input.businessId, source: 'amazon.orders', operation: 'import_order',
            title: 'Amazon order could not be imported', error,
            context: { channelInstanceId: input.channelInstanceId, amazonOrderId: order.AmazonOrderId },
            reference: { type: 'sales_channel_event', id: event.id },
          }).catch(() => null);
        }
      }
      if (totals.hasMore) break;
      nextToken = response.nextToken;
      if (!nextToken) { exhausted = true; break; }
    }
    if (!exhausted) totals.hasMore = true;
    if (totals.hasMore && totals.failed === 0) {
      await SalesChannelInstanceRepository.setAmazonOrderSyncContinuationForBusiness({
        businessId: input.businessId, channelInstanceId: input.channelInstanceId,
        lastUpdatedAfter: after.toISOString(), lastUpdatedBefore: before.toISOString(), nextToken: nextToken ?? '',
      });
    }
    if (exhausted && totals.failed === 0) {
      await SalesChannelInstanceRepository.setAmazonOrderSyncCursorForBusiness({
        businessId: input.businessId, channelInstanceId: input.channelInstanceId,
        lastUpdatedAt: before.toISOString(),
      });
    }
    return totals;
  });
}