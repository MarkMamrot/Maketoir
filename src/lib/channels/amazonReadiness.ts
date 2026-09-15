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

export async function assessAmazonReadiness(input: {
  businessId: string;
  channelInstanceId: string;
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
  const ambiguousCount = Math.max(0, Number(settings.refundsAmbiguousCount ?? 0));
  const checks: AmazonReadinessCheck[] = [
    { key: 'authorization', label: 'Amazon Australia connection', passed: authorizationPassed, detail: authorizationDetail },
    { key: 'dispatch_location', label: 'Dispatch location', passed: Number(local.location_ready) === 1,
      detail: Number(local.location_ready) === 1 ? 'An active IMS dispatch location is configured.' : 'Choose an active IMS dispatch location.' },
    { key: 'listings', label: 'Listing synchronization', passed: present(settings.listingsLastSyncedAt),
      detail: present(settings.listingsLastSyncedAt) ? 'A complete listing synchronization has succeeded.' : 'Run Sync listings through its final page.' },
    { key: 'mappings', label: 'Listing mappings', passed: Number(local.mapping_count) > 0 && Number(local.unresolved_mapping_count) === 0,
      detail: Number(local.mapping_count) === 0 ? 'No Amazon Australia listings have been observed.'
        : Number(local.unresolved_mapping_count) > 0 ? `${Number(local.unresolved_mapping_count)} listing mappings still need attention.`
          : 'All observed listings have exact IMS mappings.' },
    { key: 'inventory', label: 'Inventory synchronization',
      passed: present(settings.inventoryLastSyncedAt) && Number(local.inventory_mapping_count) > 0,
      detail: Number(local.inventory_mapping_count) === 0 ? 'Enable inventory for at least one linked listing.'
        : present(settings.inventoryLastSyncedAt) ? 'A complete inventory synchronization has succeeded.' : 'Run Sync inventory successfully.' },
    { key: 'orders', label: 'Order synchronization', passed: present(settings.ordersLastUpdatedAt),
      detail: present(settings.ordersLastUpdatedAt) ? 'The seller-fulfilled order cursor is established.' : 'Run Sync orders successfully.' },
    { key: 'returns', label: 'Return report synchronization', passed: present(settings.returnsLastRequestedAt),
      detail: present(settings.returnsLastRequestedAt) ? 'A return report window has completed.' : 'Run Sync returns until the return report completes.' },
    { key: 'refunds', label: 'Refund synchronization', passed: present(settings.refundsLastPostedAt),
      detail: present(settings.refundsLastPostedAt) ? 'The released refund cursor is established.' : 'Run Sync returns to verify Finance access.' },
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