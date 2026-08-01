import { execute, getPool, query } from '@/services/MySQLService';
import type { CampaignOutcomeAssessment } from '../campaignOutcomes';
import { buildCampaignMeasurementSchedule, type CampaignMeasurementSchedule } from '../planning/activationSchedule';
import type { DeliverableChannel, ForesightDeliverableDocument } from '../planning/deliverableDocument';

export interface CampaignActivationChannel {
  channel: Exclude<DeliverableChannel, 'campaign_brief'>;
  campaignId: string | null;
  adSetId: string | null;
  flowId: string | null;
}

export interface CampaignActivationRow extends CampaignMeasurementSchedule {
  id: number;
  business_id: string;
  thread_id: number;
  plan_version_id: number;
  plan_hash: string;
  deliverable_version_id: number;
  document_hash: string;
  activated_on: string;
  channels_json: CampaignActivationChannel[];
  destination_url: string | null;
  utm_json: Record<string, string>;
  asset_ids_json: string[];
  published_details: string;
  deviations_text: string | null;
  operator_note: string;
  horizon_days: number;
  baseline_start: string;
  baseline_end: string;
  followup_start: string;
  followup_end: string;
  first_assessment_date: string;
  activated_by: number;
  created_at: string;
}

export interface CampaignActivationOutcomeRow {
  id: number;
  business_id: string;
  activation_id: number;
  thread_id: number;
  deliverable_version_id: number;
  document_hash: string;
  horizon_days: number;
  baseline_start: string;
  baseline_end: string;
  followup_start: string;
  followup_end: string;
  direction: CampaignOutcomeAssessment['direction'];
  primary_metric: string | null;
  baseline_value: number | string | null;
  followup_value: number | string | null;
  assessment_json: CampaignOutcomeAssessment;
  created_at: string;
}

export class CampaignActivationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignActivationValidationError';
  }
}

function json<T>(value: T | string): T {
  return typeof value === 'string' ? JSON.parse(value) as T : value;
}

function cleanText(value: string | null | undefined, max: number): string | null {
  const cleaned = value?.trim() ?? '';
  if (!cleaned) return null;
  if (cleaned.length > max) throw new CampaignActivationValidationError(`Activation text exceeds ${max} characters.`);
  return cleaned;
}

function normalizeChannels(channels: CampaignActivationChannel[]): CampaignActivationChannel[] {
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new CampaignActivationValidationError('At least one activated channel is required.');
  }
  const allowed = new Set(['meta', 'google_ads', 'klaviyo']);
  return channels.map((item) => {
    if (!allowed.has(item.channel)) throw new CampaignActivationValidationError('Activation channel is invalid.');
    const normalized = {
      channel: item.channel,
      campaignId: cleanText(item.campaignId, 255),
      adSetId: cleanText(item.adSetId, 255),
      flowId: cleanText(item.flowId, 255),
    };
    if (!normalized.campaignId && !normalized.adSetId && !normalized.flowId) {
      throw new CampaignActivationValidationError(`An external identifier is required for ${item.channel}.`);
    }
    return normalized;
  });
}

function normalizeUrl(value: string | null | undefined): string | null {
  const cleaned = cleanText(value, 2_000);
  if (!cleaned) return null;
  let url: URL;
  try { url = new URL(cleaned); } catch { throw new CampaignActivationValidationError('destinationUrl must be a valid HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new CampaignActivationValidationError('destinationUrl must be a valid HTTP(S) URL.');
  }
  return url.toString();
}

export const ForesightCampaignActivationRepository = {
  async listDue(businessId: string, throughDate: string): Promise<CampaignActivationRow[]> {
    const rows = await query<CampaignActivationRow>(
      `SELECT activation.*
       FROM foresight_campaign_activations activation
       LEFT JOIN foresight_campaign_activation_outcomes outcome
         ON outcome.business_id = activation.business_id
        AND outcome.activation_id = activation.id
        AND outcome.horizon_days = activation.horizon_days
       WHERE activation.business_id = ?
         AND activation.followup_end <= ?
         AND outcome.id IS NULL
       ORDER BY activation.first_assessment_date ASC, activation.id ASC`,
      [businessId, throughDate],
    );
    return rows.map((row) => ({
      ...row,
      channels_json: json(row.channels_json),
      utm_json: json(row.utm_json),
      asset_ids_json: json(row.asset_ids_json),
      horizonDays: Number(row.horizon_days),
      baselineStart: row.baseline_start,
      baselineEnd: row.baseline_end,
      followupStart: row.followup_start,
      followupEnd: row.followup_end,
      firstAssessmentDate: row.first_assessment_date,
    }));
  },

  async getForThread(businessId: string, threadId: number): Promise<CampaignActivationRow | null> {
    const rows = await query<CampaignActivationRow>(
      `SELECT activation.*
       FROM foresight_campaign_activations activation
       INNER JOIN foresight_planning_threads thread
         ON thread.business_id = activation.business_id AND thread.id = activation.thread_id
       WHERE activation.business_id = ? AND activation.thread_id = ?
       ORDER BY activation.id DESC LIMIT 1`,
      [businessId, threadId],
    );
    return rows[0] ? {
      ...rows[0],
      channels_json: json(rows[0].channels_json),
      utm_json: json(rows[0].utm_json),
      asset_ids_json: json(rows[0].asset_ids_json),
      horizonDays: Number(rows[0].horizon_days),
      baselineStart: rows[0].baseline_start,
      baselineEnd: rows[0].baseline_end,
      followupStart: rows[0].followup_start,
      followupEnd: rows[0].followup_end,
      firstAssessmentDate: rows[0].first_assessment_date,
    } : null;
  },

  async getOutcomeForThread(businessId: string, threadId: number): Promise<CampaignActivationOutcomeRow | null> {
    const rows = await query<CampaignActivationOutcomeRow>(
      `SELECT outcome.*
       FROM foresight_campaign_activation_outcomes outcome
       INNER JOIN foresight_campaign_activations activation
         ON activation.business_id = outcome.business_id AND activation.id = outcome.activation_id
       WHERE outcome.business_id = ? AND outcome.thread_id = ?
       ORDER BY outcome.id DESC LIMIT 1`,
      [businessId, threadId],
    );
    return rows[0] ? { ...rows[0], assessment_json: json(rows[0].assessment_json) } : null;
  },

  async createOutcome(businessId: string, input: {
    activation: CampaignActivationRow;
    assessment: CampaignOutcomeAssessment;
  }): Promise<number> {
    const result = await execute(
      `INSERT INTO foresight_campaign_activation_outcomes
         (business_id, activation_id, thread_id, deliverable_version_id, document_hash,
          horizon_days, baseline_start, baseline_end, followup_start, followup_end,
          direction, primary_metric, baseline_value, followup_value, assessment_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [
        businessId,
        input.activation.id,
        input.activation.thread_id,
        input.activation.deliverable_version_id,
        input.activation.document_hash,
        input.activation.horizon_days,
        input.activation.baseline_start,
        input.activation.baseline_end,
        input.activation.followup_start,
        input.activation.followup_end,
        input.assessment.direction,
        input.assessment.primaryMetric,
        input.assessment.baselineValue,
        input.assessment.followupValue,
        JSON.stringify(input.assessment),
      ],
    );
    return result.insertId;
  },

  async create(businessId: string, threadId: number, input: {
    deliverableVersionId: number;
    documentHash: string;
    activatedOn: string;
    businessToday: string;
    channels: CampaignActivationChannel[];
    destinationUrl?: string | null;
    utm?: Record<string, string>;
    assetIds: string[];
    publishedDetails: string;
    deviationsText?: string | null;
    operatorNote: string;
    horizonDays: number;
    activatedBy: number;
  }): Promise<CampaignActivationRow> {
    const schedule = buildCampaignMeasurementSchedule(input.activatedOn, input.horizonDays);
    if (input.activatedOn > input.businessToday) {
      throw new CampaignActivationValidationError('Activation date cannot be in the future for this business.');
    }
    const channels = normalizeChannels(input.channels);
    const destinationUrl = normalizeUrl(input.destinationUrl);
    const publishedDetails = cleanText(input.publishedDetails, 8_000);
    const operatorNote = cleanText(input.operatorNote, 8_000);
    const deviationsText = cleanText(input.deviationsText, 8_000);
    if (!publishedDetails || !operatorNote) {
      throw new CampaignActivationValidationError('Published details and operator note are required.');
    }
    const utm = Object.fromEntries(Object.entries(input.utm ?? {}).flatMap(([key, value]) => {
      const cleanKey = cleanText(key, 100);
      const cleanValue = cleanText(value, 500);
      return cleanKey && cleanValue ? [[cleanKey, cleanValue]] : [];
    }));
    const assetIds = [...new Set(input.assetIds.map((id) => id.trim()).filter(Boolean))];
    if (assetIds.length === 0) throw new CampaignActivationValidationError('Select at least one asset that was actually used.');

    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT deliverable.id, deliverable.plan_version_id, deliverable.plan_hash,
                deliverable.document_hash, deliverable.document_json, review.action
         FROM foresight_deliverable_versions deliverable
         LEFT JOIN foresight_deliverable_review_events review
           ON review.business_id = deliverable.business_id
          AND review.deliverable_version_id = deliverable.id
          AND review.id = (SELECT MAX(latest_review.id) FROM foresight_deliverable_review_events latest_review
                           WHERE latest_review.business_id = deliverable.business_id
                             AND latest_review.deliverable_version_id = deliverable.id)
         WHERE deliverable.business_id = ? AND deliverable.thread_id = ?
         ORDER BY deliverable.version DESC LIMIT 1 FOR UPDATE`,
        [businessId, threadId],
      );
      const deliverable = (rows as Array<{
        id: number; plan_version_id: number; plan_hash: string; document_hash: string;
        document_json: ForesightDeliverableDocument | string; action: string | null;
      }>)[0];
      if (!deliverable || deliverable.id !== input.deliverableVersionId || deliverable.document_hash !== input.documentHash) {
        throw new CampaignActivationValidationError('Activation requires the exact latest deliverable package.');
      }
      if (deliverable.action !== 'accepted') {
        throw new CampaignActivationValidationError('The exact deliverable package must be accepted before activation is recorded.');
      }
      const document = json(deliverable.document_json);
      const activatedChannels = new Set(channels.map((channel) => channel.channel));
      const knownAssetIds = new Set(document.assets
        .filter((asset) => asset.channel !== 'campaign_brief' && activatedChannels.has(asset.channel))
        .map((asset) => asset.id));
      const unknownAssetIds = assetIds.filter((id) => !knownAssetIds.has(id));
      if (unknownAssetIds.length > 0) {
        throw new CampaignActivationValidationError(`Asset IDs do not belong to the activated channels: ${unknownAssetIds.join(', ')}.`);
      }
      const [result] = await connection.execute(
        `INSERT INTO foresight_campaign_activations
           (business_id, thread_id, plan_version_id, plan_hash, deliverable_version_id,
            document_hash, activated_on, channels_json, destination_url, utm_json,
            asset_ids_json, published_details, deviations_text, operator_note, horizon_days,
            baseline_start, baseline_end, followup_start, followup_end, first_assessment_date,
            activated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          businessId, threadId, deliverable.plan_version_id, deliverable.plan_hash,
          input.deliverableVersionId, input.documentHash, input.activatedOn, JSON.stringify(channels),
          destinationUrl, JSON.stringify(utm), JSON.stringify(assetIds), publishedDetails,
          deviationsText, operatorNote, schedule.horizonDays, schedule.baselineStart,
          schedule.baselineEnd, schedule.followupStart, schedule.followupEnd,
          schedule.firstAssessmentDate, input.activatedBy,
        ],
      );
      await connection.commit();
      return {
        id: (result as { insertId: number }).insertId,
        business_id: businessId,
        thread_id: threadId,
        plan_version_id: deliverable.plan_version_id,
        plan_hash: deliverable.plan_hash,
        deliverable_version_id: input.deliverableVersionId,
        document_hash: input.documentHash,
        activated_on: input.activatedOn,
        channels_json: channels,
        destination_url: destinationUrl,
        utm_json: utm,
        asset_ids_json: assetIds,
        published_details: publishedDetails,
        deviations_text: deviationsText,
        operator_note: operatorNote,
        horizon_days: schedule.horizonDays,
        baseline_start: schedule.baselineStart,
        baseline_end: schedule.baselineEnd,
        followup_start: schedule.followupStart,
        followup_end: schedule.followupEnd,
        first_assessment_date: schedule.firstAssessmentDate,
        activated_by: input.activatedBy,
        created_at: new Date().toISOString(),
        ...schedule,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};