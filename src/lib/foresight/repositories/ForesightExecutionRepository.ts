import { getPool, query } from '@/services/MySQLService';
import { assertRecommendationTransition } from '../recommendationState';
import type { RecommendationState } from '../types';

export type ForesightExecutionState = 'in_progress' | 'succeeded' | 'failed';

export interface ForesightExecutionRow {
  id: number;
  business_id: string;
  recommendation_id: number;
  approval_id: number;
  idempotency_key: string;
  state: ForesightExecutionState;
  before_json: Record<string, unknown>;
  request_json: Record<string, unknown>;
  response_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  error_text: string | null;
  compensates_execution_id: number | null;
  created_at: string;
  completed_at: string | null;
  completion_date?: string | null;
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  return typeof value === 'string'
    ? JSON.parse(value) as Record<string, unknown>
    : value as Record<string, unknown>;
}

function normalize(row: ForesightExecutionRow): ForesightExecutionRow {
  return {
    ...row,
    before_json: parseJson(row.before_json) ?? {},
    request_json: parseJson(row.request_json) ?? {},
    response_json: parseJson(row.response_json),
    after_json: parseJson(row.after_json),
  };
}

export const ForesightExecutionRepository = {
  async findByIdempotencyKey(
    businessId: string,
    idempotencyKey: string,
  ): Promise<ForesightExecutionRow | null> {
    const rows = await query<ForesightExecutionRow>(
      `SELECT * FROM foresight_executions
       WHERE business_id = ? AND idempotency_key = ? LIMIT 1`,
      [businessId, idempotencyKey],
    );
    return rows[0] ? normalize(rows[0]) : null;
  },

  async getExecution(
    businessId: string,
    executionId: number,
  ): Promise<ForesightExecutionRow | null> {
    const rows = await query<ForesightExecutionRow>(
      `SELECT * FROM foresight_executions
       WHERE business_id = ? AND id = ? LIMIT 1`,
      [businessId, executionId],
    );
    return rows[0] ? normalize(rows[0]) : null;
  },

  async findCompensation(
    businessId: string,
    originalExecutionId: number,
  ): Promise<ForesightExecutionRow | null> {
    const rows = await query<ForesightExecutionRow>(
      `SELECT * FROM foresight_executions
       WHERE business_id = ? AND compensates_execution_id = ?
       ORDER BY id DESC LIMIT 1`,
      [businessId, originalExecutionId],
    );
    return rows[0] ? normalize(rows[0]) : null;
  },

  async listForRecommendations(
    businessId: string,
    recommendationIds: number[],
  ): Promise<ForesightExecutionRow[]> {
    if (recommendationIds.length === 0) return [];
    const placeholders = recommendationIds.map(() => '?').join(',');
    const rows = await query<ForesightExecutionRow>(
      `SELECT *, DATE_FORMAT(completed_at, '%Y-%m-%d') AS completion_date FROM foresight_executions
       WHERE business_id = ? AND recommendation_id IN (${placeholders})
       ORDER BY created_at DESC, id DESC`,
      [businessId, ...recommendationIds],
    );
    return rows.map(normalize);
  },

  async claim(input: {
    businessId: string;
    recommendationId: number;
    actorId: number;
    proposalHash: string;
    idempotencyKey: string;
    before: Record<string, unknown>;
    request: Record<string, unknown>;
  }): Promise<{ created: boolean; execution: ForesightExecutionRow }> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [recommendationRows] = await connection.execute(
        `SELECT state, proposal_hash FROM foresight_recommendations
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [input.businessId, input.recommendationId],
      );
      const recommendation = (recommendationRows as Array<{
        state: RecommendationState;
        proposal_hash: string | null;
      }>)[0];
      if (!recommendation) throw new Error('Foresight recommendation not found.');

      const [existingRows] = await connection.execute(
        `SELECT * FROM foresight_executions
         WHERE business_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE`,
        [input.businessId, input.idempotencyKey],
      );
      const existing = (existingRows as ForesightExecutionRow[])[0];
      if (existing) {
        await connection.commit();
        return { created: false, execution: normalize(existing) };
      }

      if (recommendation.state !== 'approved') {
        throw new Error('Only approved Foresight recommendations can execute.');
      }
      if (!recommendation.proposal_hash || recommendation.proposal_hash !== input.proposalHash) {
        throw new Error('Foresight proposal changed; refresh before execution.');
      }
      assertRecommendationTransition(recommendation.state, 'executing');

      const [approvalRows] = await connection.execute(
        `SELECT id FROM foresight_approvals
         WHERE business_id = ? AND recommendation_id = ? AND decision = 'approved'
         ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [input.businessId, input.recommendationId],
      );
      const approval = (approvalRows as Array<{ id: number }>)[0];
      if (!approval) throw new Error('Approved Foresight decision not found.');

      const [insertResult] = await connection.execute(
        `INSERT INTO foresight_executions
           (business_id, recommendation_id, approval_id, idempotency_key, state,
            before_json, request_json)
         VALUES (?, ?, ?, ?, 'in_progress', ?, ?)`,
        [
          input.businessId,
          input.recommendationId,
          approval.id,
          input.idempotencyKey,
          JSON.stringify(input.before),
          JSON.stringify(input.request),
        ],
      );
      const executionId = (insertResult as { insertId: number }).insertId;
      await connection.execute(
        `UPDATE foresight_recommendations SET state = 'executing', updated_at = CURRENT_TIMESTAMP
         WHERE business_id = ? AND id = ?`,
        [input.businessId, input.recommendationId],
      );
      await connection.execute(
        `INSERT INTO foresight_recommendation_events
           (business_id, recommendation_id, from_state, to_state, proposal_hash, actor_id, reason_code, note)
         VALUES (?, ?, 'approved', 'executing', ?, ?, 'google_ads_execution_started', ?)`,
        [input.businessId, input.recommendationId, input.proposalHash, input.actorId, `Execution ${executionId}`],
      );
      const [executionRows] = await connection.execute(
        'SELECT * FROM foresight_executions WHERE id = ? AND business_id = ? LIMIT 1',
        [executionId, input.businessId],
      );
      await connection.commit();
      return { created: true, execution: normalize((executionRows as ForesightExecutionRow[])[0]) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async complete(input: {
    businessId: string;
    executionId: number;
    actorId: number;
    state: 'succeeded' | 'failed';
    response: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    errorText: string | null;
  }): Promise<ForesightExecutionRow> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [executionRows] = await connection.execute(
        `SELECT * FROM foresight_executions
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [input.businessId, input.executionId],
      );
      const execution = (executionRows as ForesightExecutionRow[])[0];
      if (!execution) throw new Error('Foresight execution not found.');
      if (execution.state !== 'in_progress') {
        await connection.commit();
        return normalize(execution);
      }

      const [recommendationRows] = await connection.execute(
        `SELECT state, proposal_hash FROM foresight_recommendations
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [input.businessId, execution.recommendation_id],
      );
      const recommendation = (recommendationRows as Array<{
        state: RecommendationState;
        proposal_hash: string | null;
      }>)[0];
      if (!recommendation) throw new Error('Foresight recommendation not found.');
      assertRecommendationTransition(recommendation.state, input.state);

      await connection.execute(
        `UPDATE foresight_executions
         SET state = ?, response_json = ?, after_json = ?, error_text = ?, completed_at = CURRENT_TIMESTAMP
         WHERE business_id = ? AND id = ?`,
        [
          input.state,
          input.response ? JSON.stringify(input.response) : null,
          input.after ? JSON.stringify(input.after) : null,
          input.errorText,
          input.businessId,
          input.executionId,
        ],
      );
      await connection.execute(
        `UPDATE foresight_recommendations SET state = ?, updated_at = CURRENT_TIMESTAMP
         WHERE business_id = ? AND id = ?`,
        [input.state, input.businessId, execution.recommendation_id],
      );
      await connection.execute(
        `INSERT INTO foresight_recommendation_events
           (business_id, recommendation_id, from_state, to_state, proposal_hash, actor_id, reason_code, note)
         VALUES (?, ?, 'executing', ?, ?, ?, ?, ?)`,
        [
          input.businessId,
          execution.recommendation_id,
          input.state,
          recommendation.proposal_hash,
          input.actorId,
          input.state === 'succeeded' ? 'google_ads_execution_succeeded' : 'google_ads_execution_failed',
          input.errorText ?? `Execution ${input.executionId}`,
        ],
      );
      const [completedRows] = await connection.execute(
        'SELECT * FROM foresight_executions WHERE id = ? AND business_id = ? LIMIT 1',
        [input.executionId, input.businessId],
      );
      await connection.commit();
      return normalize((completedRows as ForesightExecutionRow[])[0]);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async claimCompensation(input: {
    businessId: string;
    recommendationId: number;
    originalExecutionId: number;
    actorId: number;
    proposalHash: string;
    idempotencyKey: string;
    before: Record<string, unknown>;
    request: Record<string, unknown>;
  }): Promise<{ created: boolean; execution: ForesightExecutionRow }> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [originalRows] = await connection.execute(
        `SELECT * FROM foresight_executions
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [input.businessId, input.originalExecutionId],
      );
      const original = (originalRows as ForesightExecutionRow[])[0];
      if (!original) throw new Error('Original Foresight execution not found.');
      if (original.recommendation_id !== input.recommendationId || original.compensates_execution_id != null) {
        throw new Error('Execution does not belong to this recommendation or is already a compensation.');
      }
      if (original.state !== 'succeeded') {
        throw new Error('Only a succeeded Foresight execution can be compensated.');
      }

      const [existingRows] = await connection.execute(
        `SELECT * FROM foresight_executions
         WHERE business_id = ? AND compensates_execution_id = ?
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [input.businessId, input.originalExecutionId],
      );
      const existing = (existingRows as ForesightExecutionRow[])[0];
      if (existing) {
        await connection.commit();
        return { created: false, execution: normalize(existing) };
      }

      const [recommendationRows] = await connection.execute(
        `SELECT state, proposal_hash FROM foresight_recommendations
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [input.businessId, input.recommendationId],
      );
      const recommendation = (recommendationRows as Array<{
        state: RecommendationState;
        proposal_hash: string | null;
      }>)[0];
      if (!recommendation) throw new Error('Foresight recommendation not found.');
      if (recommendation.state !== 'succeeded') {
        throw new Error('Only a succeeded Foresight recommendation can be compensated.');
      }
      if (!recommendation.proposal_hash || recommendation.proposal_hash !== input.proposalHash) {
        throw new Error('Foresight proposal changed; refresh before rollback.');
      }

      const [keyRows] = await connection.execute(
        `SELECT * FROM foresight_executions
         WHERE business_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE`,
        [input.businessId, input.idempotencyKey],
      );
      const existingKey = (keyRows as ForesightExecutionRow[])[0];
      if (existingKey) {
        await connection.commit();
        return { created: false, execution: normalize(existingKey) };
      }

      const [insertResult] = await connection.execute(
        `INSERT INTO foresight_executions
           (business_id, recommendation_id, approval_id, idempotency_key, state,
            before_json, request_json, compensates_execution_id)
         VALUES (?, ?, ?, ?, 'in_progress', ?, ?, ?)`,
        [
          input.businessId,
          input.recommendationId,
          original.approval_id,
          input.idempotencyKey,
          JSON.stringify(input.before),
          JSON.stringify(input.request),
          input.originalExecutionId,
        ],
      );
      const executionId = (insertResult as { insertId: number }).insertId;
      await connection.execute(
        `INSERT INTO foresight_recommendation_events
           (business_id, recommendation_id, from_state, to_state, proposal_hash, actor_id, reason_code, note)
         VALUES (?, ?, 'succeeded', 'succeeded', ?, ?, 'google_ads_rollback_started', ?)`,
        [input.businessId, input.recommendationId, input.proposalHash, input.actorId, `Compensation ${executionId} for execution ${input.originalExecutionId}`],
      );
      const [executionRows] = await connection.execute(
        'SELECT * FROM foresight_executions WHERE id = ? AND business_id = ? LIMIT 1',
        [executionId, input.businessId],
      );
      await connection.commit();
      return { created: true, execution: normalize((executionRows as ForesightExecutionRow[])[0]) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async completeCompensation(input: {
    businessId: string;
    executionId: number;
    actorId: number;
    state: 'succeeded' | 'failed';
    response: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    errorText: string | null;
  }): Promise<ForesightExecutionRow> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [executionRows] = await connection.execute(
        `SELECT * FROM foresight_executions
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [input.businessId, input.executionId],
      );
      const execution = (executionRows as ForesightExecutionRow[])[0];
      if (!execution) throw new Error('Foresight compensation execution not found.');
      if (execution.compensates_execution_id == null) {
        throw new Error('Foresight execution is not a compensation.');
      }
      if (execution.state !== 'in_progress') {
        await connection.commit();
        return normalize(execution);
      }

      const [recommendationRows] = await connection.execute(
        `SELECT state, proposal_hash FROM foresight_recommendations
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [input.businessId, execution.recommendation_id],
      );
      const recommendation = (recommendationRows as Array<{
        state: RecommendationState;
        proposal_hash: string | null;
      }>)[0];
      if (!recommendation) throw new Error('Foresight recommendation not found.');
      if (recommendation.state !== 'succeeded') {
        throw new Error('Foresight recommendation is no longer eligible for compensation.');
      }
      if (input.state === 'succeeded') {
        assertRecommendationTransition(recommendation.state, 'compensated');
      }

      await connection.execute(
        `UPDATE foresight_executions
         SET state = ?, response_json = ?, after_json = ?, error_text = ?, completed_at = CURRENT_TIMESTAMP
         WHERE business_id = ? AND id = ?`,
        [
          input.state,
          input.response ? JSON.stringify(input.response) : null,
          input.after ? JSON.stringify(input.after) : null,
          input.errorText,
          input.businessId,
          input.executionId,
        ],
      );
      if (input.state === 'succeeded') {
        await connection.execute(
          `UPDATE foresight_recommendations SET state = 'compensated', updated_at = CURRENT_TIMESTAMP
           WHERE business_id = ? AND id = ?`,
          [input.businessId, execution.recommendation_id],
        );
      }
      await connection.execute(
        `INSERT INTO foresight_recommendation_events
           (business_id, recommendation_id, from_state, to_state, proposal_hash, actor_id, reason_code, note)
         VALUES (?, ?, 'succeeded', ?, ?, ?, ?, ?)`,
        [
          input.businessId,
          execution.recommendation_id,
          input.state === 'succeeded' ? 'compensated' : 'succeeded',
          recommendation.proposal_hash,
          input.actorId,
          input.state === 'succeeded' ? 'google_ads_rollback_succeeded' : 'google_ads_rollback_failed',
          input.errorText ?? `Compensation ${input.executionId} for execution ${execution.compensates_execution_id}`,
        ],
      );
      const [completedRows] = await connection.execute(
        'SELECT * FROM foresight_executions WHERE id = ? AND business_id = ? LIMIT 1',
        [input.executionId, input.businessId],
      );
      await connection.commit();
      return normalize((completedRows as ForesightExecutionRow[])[0]);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};