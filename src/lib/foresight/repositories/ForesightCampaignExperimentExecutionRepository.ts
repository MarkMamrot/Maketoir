import { getPool, query } from '@/services/MySQLService';

export type CampaignExperimentExecutionState = 'in_progress' | 'succeeded' | 'failed' | 'compensated';

export interface CampaignExperimentExecutionRow {
  id: number; business_id: string; thread_id: number; experiment_version_id: number;
  package_confirmation_id: number; package_fingerprint: string; execution_fingerprint: string;
  idempotency_key: string; execution_kind: 'launch' | 'compensation'; state: CampaignExperimentExecutionState;
  meta_study_id: string | null; before_json: Record<string, unknown>; request_json: Record<string, unknown>;
  response_json: Record<string, unknown> | null; after_json: Record<string, unknown> | null;
  error_text: string | null; compensates_execution_id: number | null; actor_id: number;
  created_at: string; completed_at: string | null;
}

function json(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  return typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
}

function normalize(row: CampaignExperimentExecutionRow): CampaignExperimentExecutionRow {
  return { ...row, before_json: json(row.before_json) ?? {}, request_json: json(row.request_json) ?? {},
    response_json: json(row.response_json), after_json: json(row.after_json) };
}

export const ForesightCampaignExperimentExecutionRepository = {
  async getForExperiment(businessId: string, experimentVersionId: number, kind: 'launch' | 'compensation' = 'launch') {
    const rows = await query<CampaignExperimentExecutionRow>(
      `SELECT * FROM foresight_campaign_experiment_executions
       WHERE business_id = ? AND experiment_version_id = ? AND execution_kind = ? LIMIT 1`,
      [businessId, experimentVersionId, kind]);
    return rows[0] ? normalize(rows[0]) : null;
  },

  async claimLaunch(input: {
    businessId: string; threadId: number; experimentVersionId: number; experimentHash: string;
    packageConfirmationId: number; packageFingerprint: string; executionFingerprint: string;
    idempotencyKey: string; actorId: number; before: Record<string, unknown>; request: Record<string, unknown>;
  }): Promise<{ created: boolean; execution: CampaignExperimentExecutionRow }> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.execute(
        `SELECT * FROM foresight_campaign_experiment_executions
         WHERE business_id = ? AND experiment_version_id = ? AND execution_kind = 'launch' LIMIT 1 FOR UPDATE`,
        [input.businessId, input.experimentVersionId]);
      const existing = (existingRows as CampaignExperimentExecutionRow[])[0];
      if (existing) {
        await connection.commit();
        return { created: false, execution: normalize(existing) };
      }
      const [sourceRows] = await connection.execute(
        `SELECT experiment.experiment_hash, review.action, package.package_fingerprint
         FROM foresight_campaign_experiment_versions experiment
         INNER JOIN foresight_meta_experiment_launch_package_confirmations package
           ON package.business_id = experiment.business_id AND package.experiment_version_id = experiment.id
         LEFT JOIN foresight_campaign_experiment_review_events review
           ON review.business_id = experiment.business_id AND review.experiment_version_id = experiment.id
          AND review.id = (SELECT MAX(r.id) FROM foresight_campaign_experiment_review_events r
            WHERE r.business_id = experiment.business_id AND r.experiment_version_id = experiment.id)
         WHERE experiment.business_id = ? AND experiment.thread_id = ? AND experiment.id = ? AND package.id = ? FOR UPDATE`,
        [input.businessId, input.threadId, input.experimentVersionId, input.packageConfirmationId]);
      const source = (sourceRows as Array<{ experiment_hash: string; action: string | null; package_fingerprint: string }>)[0];
      if (!source || source.experiment_hash !== input.experimentHash || source.action !== 'accepted') {
        throw new Error('Execution requires the exact accepted campaign experiment.');
      }
      if (source.package_fingerprint !== input.packageFingerprint) throw new Error('Execution requires the exact confirmed Meta launch package.');
      const [result] = await connection.execute(
        `INSERT INTO foresight_campaign_experiment_executions
          (business_id, thread_id, experiment_version_id, package_confirmation_id, package_fingerprint,
           execution_fingerprint, idempotency_key, execution_kind, state, before_json, request_json, actor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'launch', 'in_progress', ?, ?, ?)`,
        [input.businessId, input.threadId, input.experimentVersionId, input.packageConfirmationId,
          input.packageFingerprint, input.executionFingerprint, input.idempotencyKey,
          JSON.stringify(input.before), JSON.stringify(input.request), input.actorId]);
      const id = (result as { insertId: number }).insertId;
      const [rows] = await connection.execute(
        'SELECT * FROM foresight_campaign_experiment_executions WHERE business_id = ? AND id = ? LIMIT 1',
        [input.businessId, id]);
      await connection.commit();
      return { created: true, execution: normalize((rows as CampaignExperimentExecutionRow[])[0]) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async claimCompensation(input: {
    businessId: string; originalExecutionId: number; idempotencyKey: string; actorId: number;
    before: Record<string, unknown>; request: Record<string, unknown>;
  }): Promise<{ created: boolean; execution: CampaignExperimentExecutionRow }> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [originalRows] = await connection.execute(
        `SELECT * FROM foresight_campaign_experiment_executions
         WHERE business_id = ? AND id = ? AND execution_kind = 'launch' FOR UPDATE`,
        [input.businessId, input.originalExecutionId]);
      const original = (originalRows as CampaignExperimentExecutionRow[])[0];
      if (!original || !['succeeded', 'failed'].includes(original.state) || !original.meta_study_id) {
        throw new Error('Only a Meta experiment execution with a recorded study can be rolled back.');
      }
      const [existingRows] = await connection.execute(
        `SELECT * FROM foresight_campaign_experiment_executions
         WHERE business_id = ? AND experiment_version_id = ? AND execution_kind = 'compensation' LIMIT 1 FOR UPDATE`,
        [input.businessId, original.experiment_version_id]);
      const existing = (existingRows as CampaignExperimentExecutionRow[])[0];
      if (existing) {
        await connection.commit();
        return { created: false, execution: normalize(existing) };
      }
      const [result] = await connection.execute(
        `INSERT INTO foresight_campaign_experiment_executions
          (business_id, thread_id, experiment_version_id, package_confirmation_id, package_fingerprint,
           execution_fingerprint, idempotency_key, execution_kind, state, meta_study_id, before_json,
           request_json, compensates_execution_id, actor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'compensation', 'in_progress', ?, ?, ?, ?, ?)`,
        [original.business_id, original.thread_id, original.experiment_version_id, original.package_confirmation_id,
          original.package_fingerprint, original.execution_fingerprint, input.idempotencyKey, original.meta_study_id,
          JSON.stringify(input.before), JSON.stringify(input.request), original.id, input.actorId]);
      const id = (result as { insertId: number }).insertId;
      const [rows] = await connection.execute(
        'SELECT * FROM foresight_campaign_experiment_executions WHERE business_id = ? AND id = ? LIMIT 1',
        [input.businessId, id]);
      await connection.commit();
      return { created: true, execution: normalize((rows as CampaignExperimentExecutionRow[])[0]) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async complete(input: {
    businessId: string; executionId: number; state: 'succeeded' | 'failed' | 'compensated'; metaStudyId: string | null;
    response: Record<string, unknown> | null; after: Record<string, unknown> | null; errorText: string | null;
  }): Promise<CampaignExperimentExecutionRow> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        'SELECT * FROM foresight_campaign_experiment_executions WHERE business_id = ? AND id = ? FOR UPDATE',
        [input.businessId, input.executionId]);
      const execution = (rows as CampaignExperimentExecutionRow[])[0];
      if (!execution) throw new Error('Campaign experiment execution not found.');
      if (execution.state !== 'in_progress') {
        await connection.commit();
        return normalize(execution);
      }
      await connection.execute(
        `UPDATE foresight_campaign_experiment_executions
         SET state = ?, meta_study_id = ?, response_json = ?, after_json = ?, error_text = ?, completed_at = CURRENT_TIMESTAMP
         WHERE business_id = ? AND id = ?`,
        [input.state, input.metaStudyId, input.response ? JSON.stringify(input.response) : null,
          input.after ? JSON.stringify(input.after) : null, input.errorText, input.businessId, input.executionId]);
      const [completedRows] = await connection.execute(
        'SELECT * FROM foresight_campaign_experiment_executions WHERE business_id = ? AND id = ? LIMIT 1',
        [input.businessId, input.executionId]);
      await connection.commit();
      return normalize((completedRows as CampaignExperimentExecutionRow[])[0]);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};