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
export class CampaignExperimentResultTransitionError extends Error {
  constructor(message: string) { super(message); this.name = 'CampaignExperimentResultTransitionError'; }
}
function json<T>(value: T | string): T { return typeof value === 'string' ? JSON.parse(value) as T : value; }

export const ForesightCampaignExperimentResultRepository = {
  async getForThread(businessId: string, threadId: number): Promise<CampaignExperimentResultRow | null> {
    const rows = await query<CampaignExperimentResultRow>(
      `SELECT result.* FROM foresight_campaign_experiment_results result
       INNER JOIN foresight_campaign_experiment_launches launch ON launch.business_id = result.business_id AND launch.id = result.launch_id
       WHERE result.business_id = ? AND result.thread_id = ? ORDER BY result.id DESC LIMIT 1`, [businessId, threadId]);
    return rows[0] ? { ...rows[0], observation_json: json(rows[0].observation_json), assessment_json: json(rows[0].assessment_json) } : null;
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