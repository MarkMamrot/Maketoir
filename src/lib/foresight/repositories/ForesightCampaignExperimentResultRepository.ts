import { getPool, query } from '@/services/MySQLService';
import { assessExperimentResult, type ExperimentObservationPackage, type ExperimentResultAssessment } from '../experimentResults';
import type { ForesightCampaignExperimentDocument } from '../planning/campaignExperimentDocument';

export const FORESIGHT_EXPERIMENT_FORMULA_VERSION = 'foresight-experiment-evaluator-v1';
export interface CampaignExperimentResultRow {
  id: number; business_id: string; thread_id: number; experiment_version_id: number; experiment_hash: string;
  launch_id: number; formula_version: string; observation_json: ExperimentObservationPackage;
  assessment_json: ExperimentResultAssessment; status: ExperimentResultAssessment['status']; primary_metric: string;
  control_value: number | string | null; treatment_value: number | string | null; p_value: number | string | null;
  evaluated_by: number; created_at: string;
}
export type CampaignExperimentResultReviewAction = 'acknowledged' | 'rejected';
export interface CampaignExperimentResultReviewRow {
  id: number; business_id: string; thread_id: number; result_id: number; experiment_version_id: number;
  experiment_hash: string; launch_id: number; action: CampaignExperimentResultReviewAction;
  actor_id: number; note: string | null; created_at: string;
}
export interface AcknowledgedCampaignExperimentConclusionRow extends CampaignExperimentResultRow {
  acknowledged_at: string;
}
export interface CampaignExperimentWorkflowRow {
  recommendation_id: number;
  scheduled_end_on: string | null;
  conclusion: ExperimentResultAssessment['status'] | null;
  conclusion_review: CampaignExperimentResultReviewAction | null;
}
export interface DueCampaignExperimentRow {
  launch_id: number;
  thread_id: number;
  experiment_version_id: number;
  experiment_hash: string;
  launched_on: string;
  scheduled_end_on: string;
  channel: 'meta' | 'google_ads' | 'klaviyo';
  control_external_id: string;
  treatment_external_id: string;
  experiment_json: ForesightCampaignExperimentDocument;
}
export class CampaignExperimentResultTransitionError extends Error {
  constructor(message: string) { super(message); this.name = 'CampaignExperimentResultTransitionError'; }
}
function json<T>(value: T | string): T { return typeof value === 'string' ? JSON.parse(value) as T : value; }

export const ForesightCampaignExperimentResultRepository = {
  async listDueWithoutResult(businessId: string, throughDate: string): Promise<DueCampaignExperimentRow[]> {
    const rows = await query<DueCampaignExperimentRow & { experiment_json: ForesightCampaignExperimentDocument | string }>(
      `SELECT launch.id AS launch_id, launch.thread_id, launch.experiment_version_id, launch.experiment_hash,
              launch.launched_on, launch.scheduled_end_on, launch.channel, launch.control_external_id,
              launch.treatment_external_id, experiment.experiment_json
       FROM foresight_campaign_experiment_launches launch
       INNER JOIN foresight_campaign_experiment_versions experiment
         ON experiment.business_id = launch.business_id
        AND experiment.id = launch.experiment_version_id
        AND experiment.experiment_hash = launch.experiment_hash
       INNER JOIN foresight_campaign_experiment_review_events review
         ON review.business_id = experiment.business_id
        AND review.experiment_version_id = experiment.id
        AND review.experiment_hash = experiment.experiment_hash
        AND review.id = (SELECT MAX(r.id) FROM foresight_campaign_experiment_review_events r
                         WHERE r.business_id = experiment.business_id AND r.experiment_version_id = experiment.id)
        AND review.action = 'accepted'
       LEFT JOIN foresight_campaign_experiment_results result
         ON result.business_id = launch.business_id AND result.launch_id = launch.id
       WHERE launch.business_id = ? AND launch.scheduled_end_on <= ? AND result.id IS NULL
       ORDER BY launch.scheduled_end_on, launch.id`,
      [businessId, throughDate]);
    return rows.map((row) => ({ ...row, experiment_json: json(row.experiment_json) }));
  },

  async listWorkflowForRecommendations(businessId: string, recommendationIds: number[]): Promise<CampaignExperimentWorkflowRow[]> {
    if (recommendationIds.length === 0) return [];
    const placeholders = recommendationIds.map(() => '?').join(',');
    return query<CampaignExperimentWorkflowRow>(
      `SELECT CAST(link.link_id AS UNSIGNED) AS recommendation_id,
              launch.scheduled_end_on, result.status AS conclusion, result_review.action AS conclusion_review
       FROM foresight_plan_links link
       INNER JOIN foresight_campaign_experiment_versions experiment
         ON experiment.business_id = link.business_id AND experiment.thread_id = link.thread_id
       INNER JOIN foresight_campaign_experiment_review_events review
         ON review.business_id = experiment.business_id
        AND review.experiment_version_id = experiment.id
        AND review.experiment_hash = experiment.experiment_hash
        AND review.action = 'accepted'
       LEFT JOIN foresight_campaign_experiment_launches launch
         ON launch.business_id = experiment.business_id
        AND launch.experiment_version_id = experiment.id
        AND launch.experiment_hash = experiment.experiment_hash
       LEFT JOIN foresight_campaign_experiment_results result
         ON result.business_id = experiment.business_id
        AND result.launch_id = launch.id
        AND result.experiment_version_id = experiment.id
        AND result.experiment_hash = experiment.experiment_hash
       LEFT JOIN foresight_campaign_experiment_result_review_events result_review
         ON result_review.business_id = result.business_id
        AND result_review.result_id = result.id
        AND result_review.id = (SELECT MAX(rr.id) FROM foresight_campaign_experiment_result_review_events rr
                                WHERE rr.business_id = result.business_id AND rr.result_id = result.id)
       WHERE link.business_id = ? AND link.link_type = 'recommendation'
         AND link.link_id IN (${placeholders})
       ORDER BY experiment.id DESC`,
      [businessId, ...recommendationIds.map(String)]);
  },

  async listAcknowledged(businessId: string, input: { from: string; to: string; limit: number }): Promise<AcknowledgedCampaignExperimentConclusionRow[]> {
    const rows = await query<AcknowledgedCampaignExperimentConclusionRow>(
      `SELECT result.*, result_review.created_at AS acknowledged_at
       FROM foresight_campaign_experiment_results result
       INNER JOIN foresight_campaign_experiment_versions experiment
         ON experiment.business_id = result.business_id
        AND experiment.id = result.experiment_version_id
        AND experiment.experiment_hash = result.experiment_hash
       INNER JOIN foresight_campaign_experiment_result_review_events result_review
         ON result_review.business_id = result.business_id
        AND result_review.result_id = result.id
        AND result_review.experiment_version_id = result.experiment_version_id
        AND result_review.experiment_hash = result.experiment_hash
        AND result_review.launch_id = result.launch_id
        AND result_review.id = (SELECT MAX(r.id) FROM foresight_campaign_experiment_result_review_events r
                                WHERE r.business_id = result.business_id AND r.result_id = result.id)
        AND result_review.action = 'acknowledged'
       WHERE result.business_id = ?
         AND DATE(result.created_at) BETWEEN ? AND ?
       ORDER BY result.created_at DESC, result.id DESC
       LIMIT ${input.limit}`,
      [businessId, input.from, input.to]);
    return rows.map((row) => ({ ...row, observation_json: json(row.observation_json), assessment_json: json(row.assessment_json) }));
  },

  async getForThread(businessId: string, threadId: number): Promise<CampaignExperimentResultRow | null> {
    const rows = await query<CampaignExperimentResultRow>(
      `SELECT result.* FROM foresight_campaign_experiment_results result
       INNER JOIN foresight_campaign_experiment_launches launch ON launch.business_id = result.business_id AND launch.id = result.launch_id
       WHERE result.business_id = ? AND result.thread_id = ? ORDER BY result.id DESC LIMIT 1`, [businessId, threadId]);
    return rows[0] ? { ...rows[0], observation_json: json(rows[0].observation_json), assessment_json: json(rows[0].assessment_json) } : null;
  },

  async latestReview(businessId: string, threadId: number): Promise<CampaignExperimentResultReviewRow | null> {
    const rows = await query<CampaignExperimentResultReviewRow>(
      `SELECT result_review.* FROM foresight_campaign_experiment_result_review_events result_review
       INNER JOIN foresight_campaign_experiment_results result
         ON result.business_id = result_review.business_id AND result.id = result_review.result_id
       WHERE result_review.business_id = ? AND result_review.thread_id = ?
       ORDER BY result_review.id DESC LIMIT 1`,
      [businessId, threadId]);
    return rows[0] ?? null;
  },

  async review(businessId: string, threadId: number, input: {
    resultId: number; experimentVersionId: number; experimentHash: string; launchId: number;
    action: CampaignExperimentResultReviewAction; actorId: number; note?: string | null;
  }): Promise<number> {
    const note = input.note?.trim() || null;
    if (input.action === 'rejected' && !note) throw new CampaignExperimentResultTransitionError('A note is required when rejecting an experiment conclusion.');
    if (note && note.length > 1_000) throw new CampaignExperimentResultTransitionError('Conclusion review notes must be 1000 characters or fewer.');
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT result.id, result.experiment_version_id, result.experiment_hash, result.launch_id
         FROM foresight_campaign_experiment_results result
         WHERE result.business_id = ? AND result.thread_id = ? ORDER BY result.id DESC LIMIT 1 FOR UPDATE`,
        [businessId, threadId]);
      const result = (rows as Array<{ id: number; experiment_version_id: number; experiment_hash: string; launch_id: number }>)[0];
      if (!result || result.id !== input.resultId || result.experiment_version_id !== input.experimentVersionId
        || result.experiment_hash !== input.experimentHash || result.launch_id !== input.launchId) {
        throw new CampaignExperimentResultTransitionError('Only the exact latest automated experiment conclusion can be reviewed.');
      }
      const [insert] = await connection.execute(
        `INSERT INTO foresight_campaign_experiment_result_review_events
          (business_id, thread_id, result_id, experiment_version_id, experiment_hash, launch_id, action, actor_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [businessId, threadId, input.resultId, input.experimentVersionId, input.experimentHash, input.launchId, input.action, input.actorId, note]);
      await connection.commit();
      return (insert as { insertId: number }).insertId;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },

  async create(businessId: string, threadId: number, input: {
    launchId: number; experimentVersionId: number; experimentHash: string; businessToday: string;
    observations: ExperimentObservationPackage; evaluatedBy: number;
  }): Promise<CampaignExperimentResultRow> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT launch.id AS launch_id, launch.launched_on, launch.scheduled_end_on,
                launch.experiment_version_id, launch.experiment_hash,
                experiment.experiment_json, review.action
         FROM foresight_campaign_experiment_launches launch
         INNER JOIN foresight_campaign_experiment_versions experiment
           ON experiment.business_id = launch.business_id AND experiment.id = launch.experiment_version_id
         LEFT JOIN foresight_campaign_experiment_review_events review
           ON review.business_id = experiment.business_id AND review.experiment_version_id = experiment.id
          AND review.id = (SELECT MAX(r.id) FROM foresight_campaign_experiment_review_events r WHERE r.business_id = experiment.business_id AND r.experiment_version_id = experiment.id)
         WHERE launch.business_id = ? AND launch.thread_id = ? ORDER BY launch.id DESC LIMIT 1 FOR UPDATE`,
        [businessId, threadId]);
      const source = (rows as Array<{ launch_id: number; launched_on: string; scheduled_end_on: string; experiment_version_id: number; experiment_hash: string; experiment_json: ForesightCampaignExperimentDocument | string; action: string | null }>)[0];
      if (!source || source.launch_id !== input.launchId || source.experiment_version_id !== input.experimentVersionId || source.experiment_hash !== input.experimentHash) {
        throw new CampaignExperimentResultTransitionError('Result requires the exact latest experiment launch and accepted design.');
      }
      if (source.action !== 'accepted') throw new CampaignExperimentResultTransitionError('The exact experiment design must remain accepted.');
      if (input.businessToday < source.scheduled_end_on) throw new CampaignExperimentResultTransitionError('Experiment results cannot be evaluated before the scheduled end date.');
      if (input.observations.observedFrom !== source.launched_on || input.observations.observedThrough !== source.scheduled_end_on) {
        throw new CampaignExperimentResultTransitionError('Observation dates must match the exact attested experiment window.');
      }
      if (!input.observations.source.trim() || input.observations.source.trim().length > 255) throw new CampaignExperimentResultTransitionError('A bounded observation source is required.');
      const assessment = assessExperimentResult(json(source.experiment_json), input.observations);
      const [result] = await connection.execute(
        `INSERT INTO foresight_campaign_experiment_results
          (business_id, thread_id, experiment_version_id, experiment_hash, launch_id, formula_version,
           observation_json, assessment_json, status, primary_metric, control_value, treatment_value, p_value, evaluated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [businessId, threadId, input.experimentVersionId, input.experimentHash, input.launchId, FORESIGHT_EXPERIMENT_FORMULA_VERSION,
          JSON.stringify(input.observations), JSON.stringify(assessment), assessment.status, assessment.primaryMetric,
          assessment.controlValue, assessment.treatmentValue, assessment.test.pValue, input.evaluatedBy]);
      await connection.commit();
      return { id: (result as { insertId: number }).insertId, business_id: businessId, thread_id: threadId,
        experiment_version_id: input.experimentVersionId, experiment_hash: input.experimentHash, launch_id: input.launchId,
        formula_version: FORESIGHT_EXPERIMENT_FORMULA_VERSION, observation_json: input.observations,
        assessment_json: assessment, status: assessment.status, primary_metric: assessment.primaryMetric,
        control_value: assessment.controlValue, treatment_value: assessment.treatmentValue, p_value: assessment.test.pValue,
        evaluated_by: input.evaluatedBy, created_at: new Date().toISOString() };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },
};