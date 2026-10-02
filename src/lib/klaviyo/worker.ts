import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { decrypt } from '@/lib/encryption';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { KlaviyoService } from '@/services/KlaviyoService';
import {
  claimKlaviyoOutbox,
  completeKlaviyoOutbox,
  failKlaviyoOutbox,
  listPendingKlaviyoOutbox,
  recoverStaleKlaviyoOutbox,
  type KlaviyoOutboxRow,
} from './outboxRepository';
import { KlaviyoProfileConflictError, reconcileKlaviyoProfile } from './profileReconciliation';
import { KlaviyoSettingsRepository } from './settingsRepository';

const MAX_ATTEMPTS = 5;

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

export interface KlaviyoWorkerDependencies {
  getSettings: typeof KlaviyoSettingsRepository.get;
  getConnection: typeof ConnectionsRepository.get;
  decryptKey: typeof decrypt;
  createClient: (apiKey: string) => KlaviyoService;
  recoverStale: typeof recoverStaleKlaviyoOutbox;
  listPending: typeof listPendingKlaviyoOutbox;
  claim: typeof claimKlaviyoOutbox;
  reconcileProfile: typeof reconcileKlaviyoProfile;
  complete: typeof completeKlaviyoOutbox;
  fail: typeof failKlaviyoOutbox;
  reportIssue: typeof reportRuntimeIssue;
}

const defaultDependencies: KlaviyoWorkerDependencies = {
  getSettings: KlaviyoSettingsRepository.get,
  getConnection: ConnectionsRepository.get,
  decryptKey: decrypt,
  createClient: apiKey => new KlaviyoService(apiKey),
  recoverStale: recoverStaleKlaviyoOutbox,
  listPending: listPendingKlaviyoOutbox,
  claim: claimKlaviyoOutbox,
  reconcileProfile: reconcileKlaviyoProfile,
  complete: completeKlaviyoOutbox,
  fail: failKlaviyoOutbox,
  reportIssue: reportRuntimeIssue,
};

export interface KlaviyoWorkerResult {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  recovered: number;
}

async function processClaimedJob(
  businessId: string,
  job: KlaviyoOutboxRow,
  client: KlaviyoService,
  dependencies: KlaviyoWorkerDependencies,
): Promise<void> {
  const profile = await dependencies.reconcileProfile({ businessId, contactId: job.contactId, client });
  await client.createEvent({ ...job.event, profile: { id: profile.id } });
}

export async function processKlaviyoOutbox(
  input: { businessId: string; limit?: number },
  dependencies: KlaviyoWorkerDependencies = defaultDependencies,
): Promise<KlaviyoWorkerResult> {
  const result: KlaviyoWorkerResult = { processed: 0, sent: 0, skipped: 0, failed: 0, recovered: 0 };
  const settings = await dependencies.getSettings(input.businessId);
  if (!settings.enabled || !settings.profilesEnabled) return result;
  const connection = await dependencies.getConnection(input.businessId);
  if (!connection?.klaviyo_api_key) throw new Error('Klaviyo API key is not configured.');
  const client = dependencies.createClient(dependencies.decryptKey(connection.klaviyo_api_key));

  result.recovered = await dependencies.recoverStale(input.businessId);
  const jobs = await dependencies.listPending(input.businessId, input.limit ?? 25);
  for (const job of jobs) {
    if (!await dependencies.claim(input.businessId, job.id)) continue;
    result.processed += 1;
    if (!settings.sources[job.source]) {
      await dependencies.complete(input.businessId, job.id, `Klaviyo source ${job.source} is disabled.`);
      result.skipped += 1;
      continue;
    }
    try {
      await processClaimedJob(input.businessId, job, client, dependencies);
      await dependencies.complete(input.businessId, job.id);
      result.sent += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const retry = !(error instanceof KlaviyoProfileConflictError) && attempts < MAX_ATTEMPTS;
      await dependencies.fail({ businessId: input.businessId, id: job.id, retry,
        retryDelaySeconds: Math.min(3600, 30 * (2 ** Math.max(0, attempts - 1))), safeError: safeError(error) });
      await dependencies.reportIssue({
        businessId: input.businessId,
        source: 'klaviyo.outbox',
        operation: 'send_event',
        severity: retry ? 'warning' : 'error',
        title: 'Klaviyo commerce event delivery failed',
        error,
        context: { source: job.source, eventType: job.eventType, attempt: attempts, retry },
        reference: { type: 'klaviyo_outbox', id: job.id },
      }).catch(() => null);
      result.failed += 1;
    }
  }
  return result;
}

export async function processKlaviyoOutboxForBusiness(
  input: { businessId: string; limit?: number },
  dependencies: KlaviyoWorkerDependencies = defaultDependencies,
): Promise<KlaviyoWorkerResult> {
  return runImsForBusiness(input.businessId, () => processKlaviyoOutbox(input, dependencies));
}