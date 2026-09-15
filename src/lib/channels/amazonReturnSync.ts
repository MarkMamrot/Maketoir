import { gunzipSync } from 'node:zlib';

import { getAmazonChannelAccess } from '@/lib/channels/amazonCredentials';
import { importAmazonReturnObservations } from '@/lib/channels/amazonReturnImport';
import { parseAmazonReturnsReport } from '@/lib/channels/amazonReturnReport';
import {
  createAmazonReturnsReport,
  downloadAmazonReportDocument,
  getAmazonReport,
} from '@/lib/channels/amazonSpApi';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

const DEFAULT_LOOKBACK_DAYS = 30;
const CURSOR_OVERLAP_DAYS = 2;
const MAX_ATTEMPTS = 5;
const STALE_LOCK_MINUTES = 10;

interface ReturnReportJob {
  id: number;
  payload_json: string | { reportId?: string; dataStartTime?: string; dataEndTime?: string } | null;
  attempts: number;
  status: 'pending' | 'processing';
  is_available: number;
}

function parsePayload(value: ReturnReportJob['payload_json']) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value ?? '{}')) as { reportId?: string; dataStartTime?: string; dataEndTime?: string }; }
  catch { return {}; }
}

async function downloadReport(urlInput: string, compressionAlgorithm: string | null): Promise<string> {
  const url = new URL(urlInput);
  if (url.protocol !== 'https:') throw new Error('Amazon returned an invalid report document URL.');
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Amazon returns report download failed with HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (compressionAlgorithm && compressionAlgorithm !== 'GZIP') {
    throw new Error(`Amazon returned unsupported report compression ${compressionAlgorithm}.`);
  }
  return (compressionAlgorithm === 'GZIP' ? gunzipSync(bytes) : bytes).toString('utf8');
}

export async function syncAmazonReturnsForChannel(input: {
  businessId: string;
  channelInstanceId: string;
  now?: Date;
}): Promise<{ state: 'requested' | 'pending' | 'complete'; observed: number; ignored: number }> {
  const instance = await SalesChannelInstanceRepository.getForBusiness(input.businessId, input.channelInstanceId);
  if (!instance || instance.provider !== 'amazon') throw new Error('Amazon channel not found.');
  const access = await getAmazonChannelAccess(input.businessId, input.channelInstanceId);
  if (!access) throw new Error('Amazon authorization is missing.');
  const now = input.now ?? new Date();

  return runImsForBusiness(input.businessId, async () => {
    await imsExecute(
      `UPDATE ims_sales_channel_jobs
          SET status = 'pending', locked_at = NULL, available_at = CURRENT_TIMESTAMP(3),
              safe_error = 'Recovered after an interrupted returns worker.'
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'
          AND operation = 'returns_report' AND status = 'processing'
          AND locked_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE)`,
      [input.businessId, input.channelInstanceId, STALE_LOCK_MINUTES],
    );
    const jobs = await imsQuery<ReturnReportJob>(
      `SELECT id, payload_json, attempts, status,
              IF(available_at <= CURRENT_TIMESTAMP(3), 1, 0) AS is_available
         FROM ims_sales_channel_jobs
        WHERE business_id = ? AND channel_instance_id = ? AND provider = 'amazon'
          AND operation = 'returns_report' AND status IN ('pending','processing')
        ORDER BY id LIMIT 1`,
      [input.businessId, input.channelInstanceId],
    );
    let job = jobs[0];
    if (!job) {
      const saved = new Date(String(instance.settings.returnsLastRequestedAt ?? ''));
      const dataEndMs = Math.floor((now.getTime() - 2 * 60_000) / 3_600_000) * 3_600_000;
      const fallback = dataEndMs - DEFAULT_LOOKBACK_DAYS * 86_400_000;
      const startMs = Number.isFinite(saved.getTime())
        ? Math.max(fallback, saved.getTime() - CURSOR_OVERLAP_DAYS * 86_400_000)
        : fallback;
      const dataStartTime = new Date(startMs).toISOString();
      const dataEndTime = new Date(dataEndMs).toISOString();
      const operationKey = `amazon:returns:${dataEndTime}`;
      const created = await imsExecute(
        `INSERT IGNORE INTO ims_sales_channel_jobs
           (business_id, channel_instance_id, provider, operation, operation_key, payload_json, status)
         VALUES (?, ?, 'amazon', 'returns_report', ?, ?, 'pending')`,
        [input.businessId, input.channelInstanceId, operationKey, JSON.stringify({ dataStartTime, dataEndTime })],
      );
      if (Number(created.affectedRows ?? 0) !== 1) return { state: 'pending', observed: 0, ignored: 0 };
      job = {
        id: Number(created.insertId ?? 0), payload_json: { dataStartTime, dataEndTime },
        attempts: 0, status: 'pending', is_available: 1,
      };
    }
    if (job.status === 'processing' || Number(job.is_available) !== 1) {
      return { state: 'pending', observed: 0, ignored: 0 };
    }

    const payload = parsePayload(job.payload_json);
    if (!payload.dataEndTime) throw new Error('Amazon returns report job is invalid.');
    const claimed = await imsExecute(
      `UPDATE ims_sales_channel_jobs SET status = 'processing', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP(3), safe_error = NULL
        WHERE id = ? AND business_id = ? AND channel_instance_id = ?
          AND provider = 'amazon' AND operation = 'returns_report' AND status = 'pending'
          AND available_at <= CURRENT_TIMESTAMP(3)`,
      [job.id, input.businessId, input.channelInstanceId],
    );
    if (Number(claimed.affectedRows ?? 0) !== 1) return { state: 'pending', observed: 0, ignored: 0 };
    try {
      if (!payload.reportId) {
        if (!payload.dataStartTime) throw new Error('Amazon returns report job is invalid.');
        const reportId = await createAmazonReturnsReport(access.accessToken, payload.dataStartTime, payload.dataEndTime);
        await imsExecute(
          `UPDATE ims_sales_channel_jobs
              SET payload_json = ?, status = 'pending', locked_at = NULL, available_at = CURRENT_TIMESTAMP(3), safe_error = NULL
            WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
          [JSON.stringify({ ...payload, reportId }), job.id, input.businessId, input.channelInstanceId],
        );
        return { state: 'requested', observed: 0, ignored: 0 };
      }
      const report = await getAmazonReport(access.accessToken, payload.reportId);
      if (report.processingStatus === 'IN_QUEUE' || report.processingStatus === 'IN_PROGRESS') {
        await imsExecute(
          `UPDATE ims_sales_channel_jobs SET status = 'pending', locked_at = NULL
            WHERE id = ? AND business_id = ? AND channel_instance_id = ? AND provider = 'amazon' AND operation = 'returns_report'`,
          [job.id, input.businessId, input.channelInstanceId],
        );
        return { state: 'pending', observed: 0, ignored: 0 };
      }
      if (report.processingStatus === 'CANCELLED') {
        await imsExecute(
          `UPDATE ims_sales_channel_jobs SET status = 'complete', completed_at = CURRENT_TIMESTAMP(3), locked_at = NULL, safe_error = NULL
            WHERE id = ? AND business_id = ? AND channel_instance_id = ? AND provider = 'amazon' AND operation = 'returns_report'`,
          [job.id, input.businessId, input.channelInstanceId],
        );
        await SalesChannelInstanceRepository.setAmazonReturnSyncCursorForBusiness({
          businessId: input.businessId, channelInstanceId: input.channelInstanceId, lastRequestedAt: payload.dataEndTime,
        });
        return { state: 'complete', observed: 0, ignored: 0 };
      }
      if (report.processingStatus !== 'DONE' || !report.reportDocumentId) {
        throw new Error(`Amazon returns report ended with status ${report.processingStatus}.`);
      }
      const document = await downloadAmazonReportDocument(access.accessToken, report.reportDocumentId);
      const observations = parseAmazonReturnsReport(await downloadReport(document.url, document.compressionAlgorithm));
      const result = await importAmazonReturnObservations({
        businessId: input.businessId, channelInstanceId: input.channelInstanceId, observations,
      });
      await imsExecute(
        `UPDATE ims_sales_channel_jobs SET status = 'complete', completed_at = CURRENT_TIMESTAMP(3), locked_at = NULL, safe_error = NULL
          WHERE id = ? AND business_id = ? AND channel_instance_id = ? AND provider = 'amazon' AND operation = 'returns_report'`,
        [job.id, input.businessId, input.channelInstanceId],
      );
      await SalesChannelInstanceRepository.setAmazonReturnSyncCursorForBusiness({
        businessId: input.businessId, channelInstanceId: input.channelInstanceId, lastRequestedAt: payload.dataEndTime,
      });
      return { state: 'complete', ...result };
    } catch (error) {
      const safeError = (error instanceof Error ? error.message : 'Amazon returns synchronization failed.').slice(0, 500);
      const attempts = Number(job.attempts ?? 0) + 1;
      const retry = attempts < MAX_ATTEMPTS;
      await imsExecute(
        `UPDATE ims_sales_channel_jobs
            SET status = ?, available_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND),
                locked_at = NULL, safe_error = ?
          WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
        [retry ? 'pending' : 'failed', Math.min(3600, 30 * (2 ** Math.max(0, attempts - 1))), safeError,
          job.id, input.businessId, input.channelInstanceId],
      );
      await reportRuntimeIssue({
        businessId: input.businessId, source: 'amazon.returns', operation: 'sync_returns',
        title: 'Amazon returns could not be synchronized', error,
        context: { channelInstanceId: input.channelInstanceId, reportId: payload.reportId, attempt: attempts, retry },
        reference: { type: 'sales_channel_job', id: job.id },
      }).catch(() => null);
      throw error;
    }
  });
}