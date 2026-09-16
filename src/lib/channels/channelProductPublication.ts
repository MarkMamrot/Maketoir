import type { SalesChannelProvider } from '@/lib/channels/types';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export const CHANNEL_PRODUCT_PUBLICATION_OPERATION = 'product_publication';
const MAX_ATTEMPTS = 5;
const STALE_LOCK_MINUTES = 10;

export type ChannelProductPublicationDesiredState = 'published' | 'unpublished';

export type ChannelProductPublicationResult =
  | { outcome: 'applied'; providerState: 'published' | 'unpublished'; externalProductId?: string | null }
  | { outcome: 'blocked'; issues: string[] };

export type ChannelProductPublicationAdapter = (input: {
  businessId: string;
  channelInstanceId: string;
  productId: string;
  desiredState: ChannelProductPublicationDesiredState;
}) => Promise<ChannelProductPublicationResult>;

interface PublicationJobRow {
  id: number;
  payload_json: string | {
    productId?: string;
    desiredState?: ChannelProductPublicationDesiredState;
  } | null;
  attempts: number;
}

interface AssignmentRow {
  desired_state: ChannelProductPublicationDesiredState;
}

interface PublicationStatusRow {
  needs_publication: number | string;
  blocked: number | string;
  pending_jobs: number | string;
  failed_jobs: number | string;
}

function parsePayload(value: PublicationJobRow['payload_json']): {
  productId: string;
  desiredState: ChannelProductPublicationDesiredState | null;
} {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const desiredState = parsed?.desiredState === 'published' || parsed?.desiredState === 'unpublished'
      ? parsed.desiredState
      : null;
    return { productId: String(parsed?.productId ?? '').trim(), desiredState };
  } catch {
    return { productId: '', desiredState: null };
  }
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : 'Channel product publication failed.').slice(0, 500);
}

export async function enqueueChannelProductPublicationJobs(input: {
  businessId: string;
  channelInstanceId: string;
  provider: SalesChannelProvider;
}): Promise<number> {
  const result = await imsExecute(
    `INSERT IGNORE INTO ims_sales_channel_jobs
       (business_id, channel_instance_id, provider, operation, operation_key, payload_json)
         SELECT assignment.business_id, assignment.channel_instance_id, ?, ?,
           CONCAT('product_publication:', assignment.product_id, ':', assignment.desired_state, ':',
        DATE_FORMAT(assignment.updated_at, '%Y%m%d%H%i%s%f')),
            JSON_OBJECT('productId', assignment.product_id, 'desiredState', assignment.desired_state)
       FROM ims_sales_channel_product_assignments assignment
      WHERE assignment.business_id = ? AND assignment.channel_instance_id = ?
        AND ((assignment.desired_state = 'published' AND assignment.provider_state <> 'published')
          OR (assignment.desired_state = 'unpublished' AND assignment.provider_state IN ('published', 'pending', 'error')))` ,
    [input.provider, CHANNEL_PRODUCT_PUBLICATION_OPERATION, input.businessId, input.channelInstanceId],
  );
  return Number(result.affectedRows ?? 0);
}

export async function processChannelProductPublicationJobs(input: {
  businessId: string;
  channelInstanceId: string;
  provider: SalesChannelProvider;
  adapter: ChannelProductPublicationAdapter;
  limit?: number;
}): Promise<{ processed: number; applied: number; blocked: number; skipped: number; failed: number }> {
  const result = { processed: 0, applied: 0, blocked: 0, skipped: 0, failed: 0 };
  await imsExecute(
    `UPDATE ims_sales_channel_jobs
        SET status = 'pending', locked_at = NULL, available_at = CURRENT_TIMESTAMP(3),
            safe_error = 'Recovered after an interrupted product publication worker.'
      WHERE business_id = ? AND channel_instance_id = ? AND provider = ? AND operation = ?
        AND status = 'processing' AND locked_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE)`,
    [input.businessId, input.channelInstanceId, input.provider, CHANNEL_PRODUCT_PUBLICATION_OPERATION, STALE_LOCK_MINUTES],
  );
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 25)));
  const jobs = await imsQuery<PublicationJobRow>(
    `SELECT id, payload_json, attempts
       FROM ims_sales_channel_jobs
      WHERE business_id = ? AND channel_instance_id = ? AND provider = ? AND operation = ?
        AND status = 'pending' AND available_at <= CURRENT_TIMESTAMP(3)
      ORDER BY available_at, id LIMIT ${limit}`,
    [input.businessId, input.channelInstanceId, input.provider, CHANNEL_PRODUCT_PUBLICATION_OPERATION],
  );
  for (const job of jobs) {
    const claimed = await imsExecute(
      `UPDATE ims_sales_channel_jobs
          SET status = 'processing', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP(3), safe_error = NULL
        WHERE id = ? AND business_id = ? AND channel_instance_id = ? AND provider = ?
          AND operation = ? AND status = 'pending'`,
      [job.id, input.businessId, input.channelInstanceId, input.provider, CHANNEL_PRODUCT_PUBLICATION_OPERATION],
    );
    if (Number(claimed.affectedRows ?? 0) !== 1) continue;
    result.processed += 1;
    const payload = parsePayload(job.payload_json);
    try {
      const assignments = payload.productId && payload.desiredState
        ? await imsQuery<AssignmentRow>(
          `SELECT desired_state FROM ims_sales_channel_product_assignments
            WHERE business_id = ? AND channel_instance_id = ? AND product_id = ? LIMIT 1`,
          [input.businessId, input.channelInstanceId, payload.productId],
        )
        : [];
      if (!assignments[0] || assignments[0].desired_state !== payload.desiredState) {
        await imsExecute(
          `UPDATE ims_sales_channel_jobs SET status = 'complete', completed_at = CURRENT_TIMESTAMP(3), locked_at = NULL,
              safe_error = 'Skipped because assignment intent changed.'
            WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
          [job.id, input.businessId, input.channelInstanceId],
        );
        result.skipped += 1;
        continue;
      }
      await imsExecute(
        `UPDATE ims_sales_channel_product_assignments
            SET provider_state = 'pending', last_submitted_at = CURRENT_TIMESTAMP(3), updated_at = updated_at
          WHERE business_id = ? AND channel_instance_id = ? AND product_id = ? AND desired_state = ?`,
        [input.businessId, input.channelInstanceId, payload.productId, payload.desiredState],
      );
      const outcome = await input.adapter({ ...input, productId: payload.productId, desiredState: payload.desiredState });
      if (outcome.outcome === 'blocked') {
        await imsExecute(
          `UPDATE ims_sales_channel_product_assignments
              SET readiness_status = 'blocked', readiness_issues_json = ?, provider_state = 'error',
                  last_observed_at = CURRENT_TIMESTAMP(3), updated_at = updated_at
            WHERE business_id = ? AND channel_instance_id = ? AND product_id = ? AND desired_state = ?`,
          [JSON.stringify(outcome.issues.slice(0, 20)), input.businessId, input.channelInstanceId,
            payload.productId, payload.desiredState],
        );
        result.blocked += 1;
      } else {
        await imsExecute(
          `UPDATE ims_sales_channel_product_assignments
              SET readiness_status = 'ready', readiness_issues_json = NULL, provider_state = ?,
                  external_product_id = COALESCE(?, external_product_id), last_observed_at = CURRENT_TIMESTAMP(3),
                  updated_at = updated_at
            WHERE business_id = ? AND channel_instance_id = ? AND product_id = ? AND desired_state = ?`,
          [outcome.providerState, outcome.externalProductId ?? null, input.businessId, input.channelInstanceId,
            payload.productId, payload.desiredState],
        );
        result.applied += 1;
      }
      await imsExecute(
        `UPDATE ims_sales_channel_jobs SET status = 'complete', completed_at = CURRENT_TIMESTAMP(3), locked_at = NULL,
            safe_error = NULL WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
        [job.id, input.businessId, input.channelInstanceId],
      );
    } catch (error) {
      const attempts = Number(job.attempts ?? 0) + 1;
      const retry = attempts < MAX_ATTEMPTS;
      await imsExecute(
        `UPDATE ims_sales_channel_jobs
            SET status = ?, available_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
                locked_at = NULL, safe_error = ?
          WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
        [retry ? 'pending' : 'failed', Math.min(3600, 30 * (2 ** Math.max(0, attempts - 1))), safeError(error),
          job.id, input.businessId, input.channelInstanceId],
      );
      await imsExecute(
        `UPDATE ims_sales_channel_product_assignments
            SET provider_state = 'error', last_observed_at = CURRENT_TIMESTAMP(3), updated_at = updated_at
          WHERE business_id = ? AND channel_instance_id = ? AND product_id = ? AND desired_state = ?`,
        [input.businessId, input.channelInstanceId, payload.productId, payload.desiredState],
      );
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: `${input.provider}.catalogue`,
        operation: 'publish_product',
        title: `${input.provider} product publication failed`,
        error,
        context: { channelInstanceId: input.channelInstanceId, productId: payload.productId, desiredState: payload.desiredState, attempt: attempts, retry },
        reference: { type: 'sales_channel_job', id: job.id },
      }).catch(() => null);
      result.failed += 1;
    }
  }
  return result;
}

export async function syncChannelProductPublications(input: {
  businessId: string;
  channelInstanceId: string;
  provider: SalesChannelProvider;
  adapter: ChannelProductPublicationAdapter;
  enqueue?: boolean;
  limit?: number;
}): Promise<{ queued: number; processed: number; applied: number; blocked: number; skipped: number; failed: number }> {
  return runImsForBusiness(input.businessId, async () => {
    const queued = input.enqueue === false ? 0 : await enqueueChannelProductPublicationJobs(input);
    const processed = await processChannelProductPublicationJobs(input);
    return { queued, ...processed };
  });
}

export async function getChannelProductPublicationStatus(input: {
  businessId: string;
  channelInstanceId: string;
  provider: SalesChannelProvider;
}): Promise<{ needsPublication: number; blocked: number; pendingJobs: number; failedJobs: number }> {
  const rows = await imsQuery<PublicationStatusRow>(
    `SELECT
       SUM(CASE WHEN (assignment.desired_state = 'published' AND assignment.provider_state <> 'published')
                  OR (assignment.desired_state = 'unpublished' AND assignment.provider_state IN ('published', 'pending', 'error'))
                THEN 1 ELSE 0 END) AS needs_publication,
       SUM(CASE WHEN assignment.readiness_status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
       (SELECT COUNT(*) FROM ims_sales_channel_jobs job
         WHERE job.business_id = ? AND job.channel_instance_id = ? AND job.provider = ?
           AND job.operation = ? AND job.status IN ('pending', 'processing')) AS pending_jobs,
       (SELECT COUNT(*) FROM ims_sales_channel_jobs job
         WHERE job.business_id = ? AND job.channel_instance_id = ? AND job.provider = ?
           AND job.operation = ? AND job.status = 'failed') AS failed_jobs
      FROM ims_sales_channel_product_assignments assignment
     WHERE assignment.business_id = ? AND assignment.channel_instance_id = ?`,
    [input.businessId, input.channelInstanceId, input.provider, CHANNEL_PRODUCT_PUBLICATION_OPERATION,
      input.businessId, input.channelInstanceId, input.provider, CHANNEL_PRODUCT_PUBLICATION_OPERATION,
      input.businessId, input.channelInstanceId],
  );
  return {
    needsPublication: Number(rows[0]?.needs_publication ?? 0),
    blocked: Number(rows[0]?.blocked ?? 0),
    pendingJobs: Number(rows[0]?.pending_jobs ?? 0),
    failedJobs: Number(rows[0]?.failed_jobs ?? 0),
  };
}