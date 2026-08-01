import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { fetchMetaDaily } from './ForesightMonitoringSyncService';
import type { ExperimentObservationPackage, ExperimentVariantObservation } from './experimentResults';
import type { ForesightCampaignExperimentDocument } from './planning/campaignExperimentDocument';
import {
  ForesightCampaignExperimentResultRepository,
  type DueCampaignExperimentRow,
} from './repositories/ForesightCampaignExperimentResultRepository';

const SYSTEM_ACTOR_ID = 0;
const META_PURCHASE_ACTIONS = [
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'purchase',
] as const;
const META_NEGATIVE_FEEDBACK_ACTIONS = new Set([
  'hide_clicks',
  'hide_all_clicks',
  'report_spam_clicks',
  'unlike_page_clicks',
]);

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function actionTotal(value: unknown, actionTypes: Set<string>): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((total, action) => {
    const item = record(action);
    return actionTypes.has(String(item.action_type ?? ''))
      ? total + nonNegativeInteger(item.value)
      : total;
  }, 0);
}

function prioritizedActionValue(value: unknown, actionTypes: readonly string[]): number {
  if (!Array.isArray(value)) return 0;
  const actions = value.map(record);
  for (const actionType of actionTypes) {
    const action = actions.find((item) => item.action_type === actionType);
    if (action) return nonNegativeInteger(action.value);
  }
  return 0;
}

function emptyVariant(design: ForesightCampaignExperimentDocument): ExperimentVariantObservation {
  return {
    sampleSize: 0,
    conversions: design.primaryMetric === 'conversion_rate' ? 0 : undefined,
    metricSum: design.primaryMetric === 'conversion_rate' ? undefined : 0,
    metricSumSquares: design.primaryMetric === 'conversion_rate' ? undefined : 0,
    guardrailEvents: Object.fromEntries(design.guardrails.map(({ metric }) => [metric, 0])),
  };
}

function unsupportedObservations(due: DueCampaignExperimentRow, reason: string): ExperimentObservationPackage {
  return {
    source: 'foresight_automated_collection',
    observedFrom: due.launched_on,
    observedThrough: due.scheduled_end_on,
    qualityIssues: [reason],
    control: emptyVariant(due.experiment_json),
    treatment: emptyVariant(due.experiment_json),
  };
}

function supportsAutomatedMeta(design: ForesightCampaignExperimentDocument): boolean {
  return design.primaryMetric === 'conversion_rate'
    && design.guardrails.length > 0
    && design.guardrails.every(({ metric }) => metric === 'meta_negative_feedback_rate');
}

function aggregateMetaVariant(rows: unknown[], campaignId: string): ExperimentVariantObservation | null {
  const matches = rows.map(record).filter((row) => String(row.campaign_id ?? '') === campaignId);
  if (matches.length === 0) return null;
  return matches.reduce<ExperimentVariantObservation>((total, row) => ({
    sampleSize: total.sampleSize + nonNegativeInteger(row.impressions),
    conversions: Number(total.conversions) + prioritizedActionValue(row.actions, META_PURCHASE_ACTIONS),
    guardrailEvents: {
      meta_negative_feedback_rate:
        (total.guardrailEvents.meta_negative_feedback_rate ?? 0)
        + actionTotal(row.actions, META_NEGATIVE_FEEDBACK_ACTIONS),
    },
  }), { sampleSize: 0, conversions: 0, guardrailEvents: { meta_negative_feedback_rate: 0 } });
}

export function buildMetaExperimentObservations(
  due: DueCampaignExperimentRow,
  rows: unknown[],
): ExperimentObservationPackage {
  if (!supportsAutomatedMeta(due.experiment_json)) {
    return unsupportedObservations(
      due,
      'The accepted experiment does not use the supported automated Meta measurement contract: purchase conversion rate with meta_negative_feedback_rate guardrails.',
    );
  }
  const control = aggregateMetaVariant(rows, due.control_external_id);
  const treatment = aggregateMetaVariant(rows, due.treatment_external_id);
  const qualityIssues: string[] = [];
  if (!control) qualityIssues.push(`Meta returned no campaign evidence for control ID ${due.control_external_id}.`);
  if (!treatment) qualityIssues.push(`Meta returned no campaign evidence for treatment ID ${due.treatment_external_id}.`);
  return {
    source: 'meta_insights_api:campaign',
    observedFrom: due.launched_on,
    observedThrough: due.scheduled_end_on,
    qualityIssues,
    control: control ?? emptyVariant(due.experiment_json),
    treatment: treatment ?? emptyVariant(due.experiment_json),
  };
}

export const ForesightExperimentEvidenceCollectionService = {
  async collectDue(businessId: string, throughDate: string) {
    let dueExperiments: DueCampaignExperimentRow[];
    let connection: Awaited<ReturnType<typeof ConnectionsRepository.get>>;
    try {
      [dueExperiments, connection] = await Promise.all([
        ForesightCampaignExperimentResultRepository.listDueWithoutResult(businessId, throughDate),
        ConnectionsRepository.get(businessId),
      ]);
    } catch (error) {
      await reportRuntimeIssue({
        businessId,
        source: 'ForesightExperimentEvidenceCollectionService',
        operation: 'load_due_experiments',
        severity: 'error',
        title: 'Automated experiment collection setup failed',
        error,
        context: { throughDate },
      }).catch(() => undefined);
      throw error;
    }
    let measuredCount = 0;
    let inconclusiveCount = 0;
    let deferredCount = 0;

    for (const due of dueExperiments) {
      try {
        let observations: ExperimentObservationPackage;
        if (due.channel !== 'meta') {
          observations = unsupportedObservations(
            due,
            `Automated exact-variant evidence collection is not yet supported for ${due.channel}.`,
          );
        } else if (!supportsAutomatedMeta(due.experiment_json)) {
          observations = unsupportedObservations(
            due,
            'The accepted legacy Meta experiment lacks the supported automated purchase and negative-feedback measurement contract.',
          );
        } else if (!connection?.meta_ad_account_id || !connection.meta_access_token) {
          deferredCount += 1;
          await reportRuntimeIssue({
            businessId,
            source: 'ForesightExperimentEvidenceCollectionService',
            operation: 'collect_due_experiment',
            severity: 'warning',
            title: 'Meta experiment evidence collection is not configured',
            error: new Error('The tenant Meta Ads connection is missing an account ID or access token.'),
            reference: { type: 'campaign_experiment_launch', id: due.launch_id },
            context: { channel: due.channel, threadId: due.thread_id, scheduledEndOn: due.scheduled_end_on },
          }).catch(() => undefined);
          continue;
        } else {
          const rows = await fetchMetaDaily(
            connection.meta_ad_account_id,
            decrypt(connection.meta_access_token),
            due.launched_on,
            due.scheduled_end_on,
            'campaign',
          );
          observations = buildMetaExperimentObservations(due, rows);
        }

        const result = await ForesightCampaignExperimentResultRepository.create(businessId, due.thread_id, {
          launchId: due.launch_id,
          experimentVersionId: due.experiment_version_id,
          experimentHash: due.experiment_hash,
          businessToday: throughDate,
          observations,
          evaluatedBy: SYSTEM_ACTOR_ID,
        });
        if (result.status === 'inconclusive') inconclusiveCount += 1;
        else measuredCount += 1;
      } catch (error) {
        deferredCount += 1;
        await reportRuntimeIssue({
          businessId,
          source: 'ForesightExperimentEvidenceCollectionService',
          operation: 'collect_due_experiment',
          severity: 'error',
          title: 'Automated campaign experiment evidence collection failed',
          error,
          reference: { type: 'campaign_experiment_launch', id: due.launch_id },
          context: { channel: due.channel, threadId: due.thread_id, scheduledEndOn: due.scheduled_end_on },
        }).catch(() => undefined);
      }
    }

    return { dueCount: dueExperiments.length, measuredCount, inconclusiveCount, deferredCount };
  },
};
