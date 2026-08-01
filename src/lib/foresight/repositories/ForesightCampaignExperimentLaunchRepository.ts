import { getPool, query } from '@/services/MySQLService';
import type { ForesightCampaignExperimentDocument } from '../planning/campaignExperimentDocument';

export interface CampaignExperimentLaunchRow {
  id: number; business_id: string; thread_id: number; experiment_version_id: number; experiment_hash: string;
  launched_on: string; scheduled_end_on: string; channel: 'meta' | 'google_ads' | 'klaviyo';
  control_external_id: string; treatment_external_id: string; control_allocation: number | string;
  treatment_allocation: number | string; target_sample_per_variant: number;
  random_assignment_attested: number | boolean; single_variable_attested: number | boolean;
  implementation_details: string; deviations_text: string | null; operator_note: string;
  launched_by: number; created_at: string;
}

export class CampaignExperimentLaunchValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'CampaignExperimentLaunchValidationError'; }
}

function json<T>(value: T | string): T { return typeof value === 'string' ? JSON.parse(value) as T : value; }
function cleanText(value: string | null | undefined, path: string, maximum: number, required = true): string | null {
  const result = value?.trim() ?? '';
  if (!result) { if (required) throw new CampaignExperimentLaunchValidationError(`${path} is required.`); return null; }
  if (result.length > maximum) throw new CampaignExperimentLaunchValidationError(`${path} must be ${maximum} characters or fewer.`);
  return result;
}
function date(value: string, path: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new CampaignExperimentLaunchValidationError(`${path} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

export const ForesightCampaignExperimentLaunchRepository = {
  async getForThread(businessId: string, threadId: number): Promise<CampaignExperimentLaunchRow | null> {
    const rows = await query<CampaignExperimentLaunchRow>(
      `SELECT launch.* FROM foresight_campaign_experiment_launches launch
       INNER JOIN foresight_campaign_experiment_versions experiment ON experiment.business_id = launch.business_id AND experiment.id = launch.experiment_version_id
       WHERE launch.business_id = ? AND launch.thread_id = ? ORDER BY launch.id DESC LIMIT 1`, [businessId, threadId]);
    return rows[0] ?? null;
  },

  async create(businessId: string, threadId: number, input: {
    experimentVersionId: number; experimentHash: string; launchedOn: string; scheduledEndOn: string;
    businessToday: string; channel: 'meta' | 'google_ads' | 'klaviyo'; controlExternalId: string;
    treatmentExternalId: string; controlAllocation: number; treatmentAllocation: number;
    targetSamplePerVariant: number; randomAssignmentAttested: boolean; singleVariableAttested: boolean;
    implementationDetails: string; deviationsText?: string | null; operatorNote: string; launchedBy: number;
  }): Promise<CampaignExperimentLaunchRow> {
    const launchedOn = date(input.launchedOn, 'launchedOn');
    const scheduledEndOn = date(input.scheduledEndOn, 'scheduledEndOn');
    if (launchedOn > input.businessToday) throw new CampaignExperimentLaunchValidationError('Launch date cannot be in the future for this business.');
    const controlExternalId = cleanText(input.controlExternalId, 'controlExternalId', 255) as string;
    const treatmentExternalId = cleanText(input.treatmentExternalId, 'treatmentExternalId', 255) as string;
    if (controlExternalId === treatmentExternalId) throw new CampaignExperimentLaunchValidationError('Control and treatment external identifiers must be different.');
    if (!input.randomAssignmentAttested || !input.singleVariableAttested) throw new CampaignExperimentLaunchValidationError('Random assignment and single-variable isolation must both be attested.');
    const implementationDetails = cleanText(input.implementationDetails, 'implementationDetails', 8_000) as string;
    const operatorNote = cleanText(input.operatorNote, 'operatorNote', 8_000) as string;
    const deviationsText = cleanText(input.deviationsText, 'deviationsText', 8_000, false);
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT experiment.id, experiment.experiment_hash, experiment.experiment_json, review.action
         FROM foresight_campaign_experiment_versions experiment
         LEFT JOIN foresight_campaign_experiment_review_events review
           ON review.business_id = experiment.business_id AND review.experiment_version_id = experiment.id
          AND review.id = (SELECT MAX(r.id) FROM foresight_campaign_experiment_review_events r WHERE r.business_id = experiment.business_id AND r.experiment_version_id = experiment.id)
         WHERE experiment.business_id = ? AND experiment.thread_id = ? ORDER BY experiment.version DESC LIMIT 1 FOR UPDATE`,
        [businessId, threadId]);
      const experiment = (rows as Array<{ id: number; experiment_hash: string; experiment_json: ForesightCampaignExperimentDocument | string; action: string | null }>)[0];
      if (!experiment || experiment.id !== input.experimentVersionId || experiment.experiment_hash !== input.experimentHash) throw new CampaignExperimentLaunchValidationError('Launch requires the exact latest campaign experiment.');
      if (experiment.action !== 'accepted') throw new CampaignExperimentLaunchValidationError('The exact campaign experiment must be accepted before launch is recorded.');
      const design = json(experiment.experiment_json);
      if (input.channel !== design.channel) throw new CampaignExperimentLaunchValidationError('Launch channel must match the accepted experiment design.');
      if (launchedOn !== design.startDate || scheduledEndOn !== design.endDate) throw new CampaignExperimentLaunchValidationError('Launch dates must match the accepted experiment design.');
      if (input.controlAllocation !== design.allocationPercent.control || input.treatmentAllocation !== design.allocationPercent.treatment) throw new CampaignExperimentLaunchValidationError('Launch allocation must match the accepted experiment design.');
      if (!Number.isInteger(input.targetSamplePerVariant) || input.targetSamplePerVariant < design.minimumSamplePerVariant) throw new CampaignExperimentLaunchValidationError('Target sample must meet the accepted minimum per variant.');
      const [result] = await connection.execute(
        `INSERT INTO foresight_campaign_experiment_launches
          (business_id, thread_id, experiment_version_id, experiment_hash, launched_on, scheduled_end_on, channel,
           control_external_id, treatment_external_id, control_allocation, treatment_allocation, target_sample_per_variant,
           random_assignment_attested, single_variable_attested, implementation_details, deviations_text, operator_note, launched_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [businessId, threadId, input.experimentVersionId, input.experimentHash, launchedOn, scheduledEndOn, input.channel,
          controlExternalId, treatmentExternalId, input.controlAllocation, input.treatmentAllocation, input.targetSamplePerVariant,
          1, 1, implementationDetails, deviationsText, operatorNote, input.launchedBy]);
      await connection.commit();
      return { id: (result as { insertId: number }).insertId, business_id: businessId, thread_id: threadId,
        experiment_version_id: input.experimentVersionId, experiment_hash: input.experimentHash, launched_on: launchedOn,
        scheduled_end_on: scheduledEndOn, channel: input.channel, control_external_id: controlExternalId,
        treatment_external_id: treatmentExternalId, control_allocation: input.controlAllocation,
        treatment_allocation: input.treatmentAllocation, target_sample_per_variant: input.targetSamplePerVariant,
        random_assignment_attested: true, single_variable_attested: true, implementation_details: implementationDetails,
        deviations_text: deviationsText, operator_note: operatorNote, launched_by: input.launchedBy, created_at: new Date().toISOString() };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },
};