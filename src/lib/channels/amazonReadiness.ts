import { getAmazonChannelAccess } from '@/lib/channels/amazonCredentials';
import { getAmazonMarketplaceParticipations, requireActiveAmazonAustraliaParticipation } from '@/lib/channels/amazonSpApi';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsQuery } from '@/services/IMSMySQLService';

export type AmazonReadinessCheckKey =
  | 'authorization' | 'dispatch_location' | 'listings' | 'mappings' | 'inventory'
  | 'orders' | 'returns' | 'refunds' | 'work_queue' | 'return_review';

export interface AmazonReadinessCheck {
  key: AmazonReadinessCheckKey;
  label: string;
  passed: boolean;
  detail: string;
}

interface LocalReadinessRow {
  location_ready: number;
  mapping_count: number;
  unresolved_mapping_count: number;
  inventory_mapping_count: number;
  channel_job_issue_count: number;
  shipping_job_issue_count: number;
  open_amazon_credit_note_count: number;
}

function present(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function recent(value: unknown, now: Date, maximumAgeMs: number): boolean {
  if (!present(value)) return false;
  const age = now.getTime() - new Date(String(value)).getTime();
  return age <= maximumAgeMs;
}

export async function assessAmazonReadiness(input: {
  businessId: string;
  channelInstanceId: string;
  now?: Date;
}): Promise<{ ready: boolean; checks: AmazonReadinessCheck[] }> {
  const instance = await SalesChannelInstanceRepository.getForBusiness(input.businessId, input.channelInstanceId);
  if (!instance || instance.provider !== 'amazon') throw new Error('Amazon channel not found.');

  let authorizationPassed = false;
  let authorizationDetail = 'Amazon authorization is missing or could not be verified.';
  try {
    const access = await getAmazonChannelAccess(input.businessId, input.channelInstanceId);
    if (access) {
      requireActiveAmazonAustraliaParticipation(await getAmazonMarketplaceParticipations(access.accessToken));
      authorizationPassed = true;
      authorizationDetail = 'Amazon Australia authorization and marketplace participation verified.';
    }
  } catch (error) {
    authorizationDetail = error instanceof Error && /does not have access|not participating|suspended/i.test(error.message)
      ? error.message
      : 'Amazon rejected the saved authorization.';
  }

  const local = await runImsForBusiness(input.businessId, async () => {
    const rows = await imsQuery<LocalReadinessRow>(
      `SELECT
         EXISTS(SELECT 1 FROM ims_locations WHERE business_id = ? AND id = ? AND is_active = 1) AS location_ready,
         (SELECT COUNT(*) FROM ims_sales_channel_product_mappings
           WHERE business_id = ? AND channel_instance_id = ? AND mapping_status <> 'archived') AS mapping_count,
         (SELECT COUNT(*) FROM ims_sales_channel_product_mappings
           WHERE business_id = ? AND channel_instance_id = ? AND mapping_status IN ('unmatched','conflict')) AS unresolved_mapping_count,
         (SELECT COUNT(*) FROM ims_sales_channel_product_mappings mapping
           JOIN ims_sales_channel_product_selections selection
             ON selection.business_id = mapping.business_id AND selection.channel_instance_id = mapping.channel_instance_id
            AND selection.variant_id = mapping.variant_id
          WHERE mapping.business_id = ? AND mapping.channel_instance_id = ? AND mapping.mapping_status = 'linked'
            AND selection.is_selected = 1 AND selection.inventory_enabled = 1) AS inventory_mapping_count,
         (SELECT COUNT(*) FROM ims_sales_channel_jobs
           WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'
             AND status IN ('pending','processing','failed')) AS channel_job_issue_count,
         (SELECT COUNT(*) FROM ims_shipping_channel_jobs
           WHERE business_id = ? AND sales_channel = 'amazon' AND status IN ('pending','failed')
             AND JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.channelInstanceId')) = ?) AS shipping_job_issue_count,
         (SELECT COUNT(*) FROM ims_credit_notes
           WHERE business_id = ? AND channel_instance_id = ? AND source = 'amazon'
             AND status IN ('draft','awaiting_product')) AS open_amazon_credit_note_count`,
      [input.businessId, Number(instance.settings.orderLocationId ?? 0),
        input.businessId, input.channelInstanceId, input.businessId, input.channelInstanceId,
        input.businessId, input.channelInstanceId, input.businessId, input.channelInstanceId,
        input.businessId, input.channelInstanceId, input.businessId, input.channelInstanceId],
    );
    return rows[0] ?? {
      location_ready: 0, mapping_count: 0, unresolved_mapping_count: 0, inventory_mapping_count: 0,
      channel_job_issue_count: 0, shipping_job_issue_count: 0, open_amazon_credit_note_count: 0,
    };
  });

  const settings = instance.settings;
  const now = input.now ?? new Date();
  const listingsReady = recent(settings.listingsLastSyncedAt, now, 24 * 60 * 60_000);
  const listingsAt = new Date(String(settings.listingsLastSyncedAt ?? '')).getTime();
  const inventoryAt = new Date(String(settings.inventoryLastSyncedAt ?? '')).getTime();
  const inventoryReady = recent(settings.inventoryLastSyncedAt, now, 60 * 60_000)
    && Number.isFinite(listingsAt) && inventoryAt >= listingsAt;
  const ordersReady = recent(settings.ordersLastUpdatedAt, now, 30 * 60_000)
    && !present(settings.ordersContinuationBefore);
  const returnsReady = recent(settings.returnsLastRequestedAt, now, 26 * 60 * 60_000);
  const refundsReady = recent(settings.refundsLastPostedAt, now, 26 * 60 * 60_000)
    && !present(settings.refundsContinuationBefore);
  const ambiguousCount = Math.max(0, Number(settings.refundsAmbiguousCount ?? 0));
  const checks: AmazonReadinessCheck[] = [
    { key: 'authorization', label: 'Amazon Australia connection', passed: authorizationPassed, detail: authorizationDetail },
    { key: 'dispatch_location', label: 'Dispatch location', passed: Number(local.location_ready) === 1,
      detail: Number(local.location_ready) === 1 ? 'An active IMS dispatch location is configured.' : 'Choose an active IMS dispatch location.' },
    { key: 'listings', label: 'Listing synchronization', passed: listingsReady,
      detail: listingsReady ? 'A complete listing synchronization succeeded in the last 24 hours.' : 'Run Sync listings through its final page.' },
    { key: 'mappings', label: 'Listing mappings', passed: Number(local.mapping_count) > 0 && Number(local.unresolved_mapping_count) === 0,
      detail: Number(local.mapping_count) === 0 ? 'No Amazon Australia listings have been observed.'
        : Number(local.unresolved_mapping_count) > 0 ? `${Number(local.unresolved_mapping_count)} listing mappings still need attention.`
          : 'All observed listings have exact IMS mappings.' },
    { key: 'inventory', label: 'Inventory synchronization',
      passed: inventoryReady && Number(local.inventory_mapping_count) > 0,
      detail: Number(local.inventory_mapping_count) === 0 ? 'Enable inventory for at least one linked listing.'
        : inventoryReady ? 'Inventory synchronized after the latest listing sync in the last hour.'
          : 'Run Sync inventory after the latest listing sync.' },
    { key: 'orders', label: 'Order synchronization', passed: ordersReady,
      detail: ordersReady ? 'The seller-fulfilled order cursor is current and its window is complete.'
        : 'Run Sync orders until no more updates remain.' },
    { key: 'returns', label: 'Return report synchronization', passed: returnsReady,
      detail: returnsReady ? 'A return report window completed in the last 26 hours.' : 'Run Sync returns until the return report completes.' },
    { key: 'refunds', label: 'Refund synchronization', passed: refundsReady,
      detail: refundsReady ? 'The released refund cursor is current and its window is complete.'
        : 'Run Sync returns until Finance pagination completes.' },
    { key: 'work_queue', label: 'Channel work queues',
      passed: Number(local.channel_job_issue_count) === 0 && Number(local.shipping_job_issue_count) === 0,
      detail: Number(local.channel_job_issue_count) + Number(local.shipping_job_issue_count) === 0
        ? 'No Amazon jobs are pending or failed.'
        : `${Number(local.channel_job_issue_count) + Number(local.shipping_job_issue_count)} Amazon jobs are pending or failed.` },
    { key: 'return_review', label: 'Return review',
      passed: ambiguousCount === 0 && Number(local.open_amazon_credit_note_count) === 0,
      detail: ambiguousCount > 0 ? `${ambiguousCount} Amazon refund matches require review.`
        : Number(local.open_amazon_credit_note_count) > 0 ? `${Number(local.open_amazon_credit_note_count)} Amazon credit-note drafts require review.`
          : 'No ambiguous refunds or unreviewed Amazon drafts remain.' },
  ];
  const ready = checks.every(check => check.passed);
  await SalesChannelInstanceRepository.setReadinessForBusiness({
    businessId: input.businessId,
    channelInstanceId: input.channelInstanceId,
    ready,
    safeError: ready ? null : checks.find(check => !check.passed)?.detail,
  });
  return { ready, checks };
}