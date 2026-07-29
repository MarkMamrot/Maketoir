import { createHash } from 'node:crypto';
import { execute, getPool, query } from '@/services/MySQLService';
import { assertRecommendationTransition } from '../recommendationState';
import type { ForesightChannel, RecommendationEvidence, RecommendationState } from '../types';
import type { RecommendationOutcomeAssessment } from '../recommendationOutcomes';
import {
  buildRecommendationImplementationPreview,
  type RecommendationImplementationPreview,
} from '../implementationPreview';

export interface StrategyVersionRow {
  id: number;
  business_id: string;
  version: number;
  parent_id: number | null;
  strategy_json: Record<string, unknown>;
  markdown_text: string;
  authored_by: number | null;
  change_reason: string | null;
  created_at: string;
}

export interface RecommendationRow {
  id: number;
  business_id: string;
  fingerprint: string;
  state: RecommendationState;
  channel: ForesightChannel;
  subject_type: string;
  subject_id: string;
  rule_id: string;
  evidence_json: RecommendationEvidence;
  proposed_action_json: Record<string, unknown> | null;
  proposal_hash: string | null;
  confidence: number | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecommendationEventRow {
  id: number;
  business_id: string;
  recommendation_id: number;
  from_state: RecommendationState;
  to_state: RecommendationState;
  proposal_hash: string | null;
  actor_id: number;
  reason_code: string | null;
  note: string | null;
  created_at: string;
}

export interface RecommendationOutcomeCandidateRow extends RecommendationRow {
  decision: 'approved' | 'rejected';
  decided_at: string;
  reference_at: string;
}

export interface RecommendationImplementationRow {
  id: number;
  business_id: string;
  recommendation_id: number;
  approval_id: number;
  proposal_hash: string;
  method: 'manual_external';
  implemented_on: string;
  implemented_by: number;
  note: string;
  preview_json: RecommendationImplementationPreview;
  created_at: string;
}

export interface RecommendationOutcomeRow {
  id: number;
  business_id: string;
  recommendation_id: number;
  decision: 'approved' | 'rejected';
  horizon_days: number;
  baseline_start: string;
  baseline_end: string;
  followup_start: string;
  followup_end: string;
  direction: RecommendationOutcomeAssessment['direction'];
  condition_state: RecommendationOutcomeAssessment['conditionState'];
  primary_metric: string | null;
  baseline_value: number | null;
  followup_value: number | null;
  assessment_json: RecommendationOutcomeAssessment;
  created_at: string;
}

export interface CreateRecommendationInput {
  fingerprint: string;
  channel: ForesightChannel;
  subjectType: string;
  subjectId: string;
  ruleId: string;
  policyVersion?: number | null;
  formulaVersion?: string | null;
  evidence: RecommendationEvidence;
  proposedAction?: Record<string, unknown> | null;
  confidence?: number | null;
  expectedImpactLow?: number | null;
  expectedImpactHigh?: number | null;
  expiresAt?: string | null;
}

function parseJson<T>(value: T | string): T {
  if (typeof value !== 'string') return value;
  return JSON.parse(value) as T;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function hashProposal(proposal: Record<string, unknown> | null | undefined): string | null {
  if (!proposal) return null;
  return createHash('sha256').update(JSON.stringify(canonicalize(proposal))).digest('hex');
}

function normalizeRecommendation(row: RecommendationRow): RecommendationRow {
  return {
    ...row,
    evidence_json: parseJson(row.evidence_json),
    proposed_action_json: row.proposed_action_json == null
      ? null
      : parseJson(row.proposed_action_json),
  };
}

export const ForesightRepository = {
  async expireSupersededShadowRecommendations(
    businessId: string,
    ruleIds: string[],
    activeFingerprints: string[],
  ): Promise<number> {
    if (ruleIds.length === 0) return 0;
    const rulePlaceholders = ruleIds.map(() => '?').join(',');
    const fingerprintClause = activeFingerprints.length > 0
      ? `AND fingerprint NOT IN (${activeFingerprints.map(() => '?').join(',')})`
      : '';
    const result = await execute(
      `UPDATE foresight_recommendations
       SET state = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE business_id = ?
         AND state = 'shadow'
         AND rule_id IN (${rulePlaceholders})
         ${fingerprintClause}`,
      [businessId, ...ruleIds, ...activeFingerprints],
    );
    return result.affectedRows;
  },

  async latestStrategy(businessId: string): Promise<StrategyVersionRow | null> {
    const rows = await query<StrategyVersionRow>(
      `SELECT * FROM foresight_strategy_versions
       WHERE business_id = ? ORDER BY version DESC LIMIT 1`,
      [businessId],
    );
    if (!rows[0]) return null;
    return { ...rows[0], strategy_json: parseJson(rows[0].strategy_json) };
  },

  async createStrategyVersion(
    businessId: string,
    input: {
      strategy: Record<string, unknown>;
      markdown: string;
      authoredBy?: number | null;
      changeReason?: string | null;
    },
  ): Promise<number> {
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT id, version FROM foresight_strategy_versions
         WHERE business_id = ? ORDER BY version DESC LIMIT 1 FOR UPDATE`,
        [businessId],
      );
      const latest = (rows as Array<{ id: number; version: number }>)[0];
      const [result] = await connection.execute(
        `INSERT INTO foresight_strategy_versions
           (business_id, version, parent_id, strategy_json, markdown_text, authored_by, change_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          businessId,
          (latest?.version ?? 0) + 1,
          latest?.id ?? null,
          JSON.stringify(input.strategy),
          input.markdown,
          input.authoredBy ?? null,
          input.changeReason ?? null,
        ],
      );
      await connection.commit();
      return (result as { insertId: number }).insertId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async createRecommendation(businessId: string, input: CreateRecommendationInput): Promise<number> {
    const proposalHash = hashProposal(input.proposedAction);
    const result = await execute(
      `INSERT INTO foresight_recommendations
         (business_id, fingerprint, state, channel, subject_type, subject_id, rule_id,
          policy_version, formula_version, evidence_json, proposed_action_json, proposal_hash,
          confidence, expected_impact_low, expected_impact_high, expires_at)
       VALUES (?, ?, 'shadow', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [
        businessId,
        input.fingerprint,
        input.channel,
        input.subjectType,
        input.subjectId,
        input.ruleId,
        input.policyVersion ?? null,
        input.formulaVersion ?? null,
        JSON.stringify(input.evidence),
        input.proposedAction ? JSON.stringify(input.proposedAction) : null,
        proposalHash,
        input.confidence ?? null,
        input.expectedImpactLow ?? null,
        input.expectedImpactHigh ?? null,
        input.expiresAt ?? null,
      ],
    );
    return result.insertId;
  },

  async getRecommendation(
    businessId: string,
    recommendationId: number,
  ): Promise<RecommendationRow | null> {
    const rows = await query<RecommendationRow>(
      `SELECT * FROM foresight_recommendations
       WHERE business_id = ? AND id = ? LIMIT 1`,
      [businessId, recommendationId],
    );
    return rows[0] ? normalizeRecommendation(rows[0]) : null;
  },

  async listRecommendations(
    businessId: string,
    states: RecommendationState[] = ['shadow', 'pending_approval', 'approved'],
  ): Promise<RecommendationRow[]> {
    if (states.length === 0) return [];
    const placeholders = states.map(() => '?').join(',');
    const rows = await query<RecommendationRow>(
      `SELECT * FROM foresight_recommendations
       WHERE business_id = ? AND state IN (${placeholders})
       ORDER BY created_at DESC`,
      [businessId, ...states],
    );
    return rows.map(normalizeRecommendation);
  },

  async listRecommendationEvents(
    businessId: string,
    recommendationIds: number[],
  ): Promise<RecommendationEventRow[]> {
    if (recommendationIds.length === 0) return [];
    const placeholders = recommendationIds.map(() => '?').join(',');
    return query<RecommendationEventRow>(
      `SELECT * FROM foresight_recommendation_events
       WHERE business_id = ? AND recommendation_id IN (${placeholders})
       ORDER BY created_at ASC, id ASC`,
      [businessId, ...recommendationIds],
    );
  },

  async listRecommendationOutcomes(
    businessId: string,
    recommendationIds: number[],
  ): Promise<RecommendationOutcomeRow[]> {
    if (recommendationIds.length === 0) return [];
    const placeholders = recommendationIds.map(() => '?').join(',');
    const rows = await query<RecommendationOutcomeRow>(
      `SELECT * FROM foresight_recommendation_outcomes
       WHERE business_id = ? AND recommendation_id IN (${placeholders})
       ORDER BY horizon_days ASC, created_at ASC`,
      [businessId, ...recommendationIds],
    );
    return rows.map((row) => ({ ...row, assessment_json: parseJson(row.assessment_json) }));
  },

  async listRecommendationImplementations(
    businessId: string,
    recommendationIds: number[],
  ): Promise<RecommendationImplementationRow[]> {
    if (recommendationIds.length === 0) return [];
    const placeholders = recommendationIds.map(() => '?').join(',');
    const rows = await query<RecommendationImplementationRow>(
      `SELECT * FROM foresight_recommendation_implementations
       WHERE business_id = ? AND recommendation_id IN (${placeholders})
       ORDER BY implemented_on ASC, id ASC`,
      [businessId, ...recommendationIds],
    );
    return rows.map((row) => ({ ...row, preview_json: parseJson(row.preview_json) }));
  },

  async listRecommendationOutcomeCandidates(
    businessId: string,
    throughDate: string,
    horizonDays: number,
  ): Promise<RecommendationOutcomeCandidateRow[]> {
    const safeHorizonDays = Math.max(1, Math.trunc(horizonDays));
    const rows = await query<RecommendationOutcomeCandidateRow>(
            `SELECT r.*, a.decision, a.created_at AS decided_at,
              CASE WHEN a.decision = 'approved'
             THEN COALESCE(i.implemented_on, DATE(x.completed_at))
             ELSE DATE(a.created_at)
              END AS reference_at
       FROM foresight_recommendations r
       INNER JOIN foresight_approvals a
         ON a.business_id = r.business_id AND a.recommendation_id = r.id
       LEFT JOIN foresight_recommendation_implementations i
         ON i.business_id = r.business_id AND i.recommendation_id = r.id
       LEFT JOIN foresight_executions x
         ON x.business_id = r.business_id
        AND x.recommendation_id = r.id
        AND x.state = 'succeeded'
       LEFT JOIN foresight_recommendation_outcomes o
         ON o.business_id = r.business_id
        AND o.recommendation_id = r.id
        AND o.horizon_days = ?
       WHERE r.business_id = ?
         AND r.channel = 'paid_media'
         AND a.decision IN ('approved', 'rejected')
         AND (a.decision = 'rejected' OR i.id IS NOT NULL OR x.id IS NOT NULL)
         AND DATE_ADD(
           CASE WHEN a.decision = 'approved'
                THEN COALESCE(i.implemented_on, DATE(x.completed_at))
                ELSE DATE(a.created_at)
           END,
           INTERVAL ${safeHorizonDays} DAY
         ) <= ?
         AND o.id IS NULL
       ORDER BY a.created_at ASC, r.id ASC`,
      [safeHorizonDays, businessId, throughDate],
    );
    return rows.map((row) => ({
      ...normalizeRecommendation(row),
      decision: row.decision,
      decided_at: row.decided_at,
      reference_at: row.reference_at,
    }));
  },

  async attestRecommendationImplementation(
    businessId: string,
    recommendationId: number,
    implementedBy: number,
    proposalHash: string,
    implementedOn: string,
    note: string,
  ): Promise<number> {
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [recommendationRows] = await connection.execute(
        `SELECT state, proposal_hash, channel, proposed_action_json FROM foresight_recommendations
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [businessId, recommendationId],
      );
      const recommendation = (recommendationRows as Array<{
        state: RecommendationState;
        proposal_hash: string | null;
        channel: ForesightChannel;
        proposed_action_json: Record<string, unknown> | string | null;
      }>)[0];
      if (!recommendation) throw new Error('Foresight recommendation not found.');
      if (recommendation.state !== 'approved') {
        throw new Error('Only approved Foresight recommendations can be recorded as implemented.');
      }
      if (!recommendation.proposal_hash || recommendation.proposal_hash !== proposalHash) {
        throw new Error('Foresight proposal changed; refresh before recording implementation.');
      }

      const [approvalRows] = await connection.execute(
        `SELECT id, DATE_FORMAT(created_at, '%Y-%m-%d') AS approved_on FROM foresight_approvals
         WHERE business_id = ? AND recommendation_id = ? AND decision = 'approved'
         ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [businessId, recommendationId],
      );
      const approval = (approvalRows as Array<{ id: number; approved_on: string }>)[0];
      if (!approval) throw new Error('Approved Foresight decision not found.');
      if (implementedOn < approval.approved_on) {
        throw new Error('Implementation date cannot be before approval.');
      }
      const proposedAction = recommendation.proposed_action_json == null
        ? null
        : parseJson(recommendation.proposed_action_json);
      const preview = buildRecommendationImplementationPreview(
        recommendation.channel,
        proposedAction,
      );

      const [result] = await connection.execute(
        `INSERT INTO foresight_recommendation_implementations
           (business_id, recommendation_id, approval_id, proposal_hash, method,
            implemented_on, implemented_by, note, preview_json)
         VALUES (?, ?, ?, ?, 'manual_external', ?, ?, ?, ?)`,
        [
          businessId,
          recommendationId,
          approval.id,
          proposalHash,
          implementedOn,
          implementedBy,
          note,
          JSON.stringify(preview),
        ],
      );
      await connection.commit();
      return (result as { insertId: number }).insertId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async createRecommendationOutcome(
    businessId: string,
    input: {
      recommendationId: number;
      decision: 'approved' | 'rejected';
      horizonDays: number;
      baselineStart: string;
      baselineEnd: string;
      followupStart: string;
      followupEnd: string;
      assessment: RecommendationOutcomeAssessment;
    },
  ): Promise<number> {
    const result = await execute(
      `INSERT INTO foresight_recommendation_outcomes
         (business_id, recommendation_id, decision, horizon_days,
          baseline_start, baseline_end, followup_start, followup_end,
          direction, condition_state, primary_metric, baseline_value, followup_value, assessment_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [
        businessId,
        input.recommendationId,
        input.decision,
        input.horizonDays,
        input.baselineStart,
        input.baselineEnd,
        input.followupStart,
        input.followupEnd,
        input.assessment.direction,
        input.assessment.conditionState,
        input.assessment.primaryMetric,
        input.assessment.baselineValue,
        input.assessment.followupValue,
        JSON.stringify(input.assessment),
      ],
    );
    return result.insertId;
  },

  async requestRecommendationApproval(
    businessId: string,
    recommendationId: number,
    requestedBy: number,
    proposalHash: string | null,
    reasonCode: string,
    note?: string | null,
  ): Promise<void> {
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT state, proposal_hash FROM foresight_recommendations
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [businessId, recommendationId],
      );
      const recommendation = (rows as Array<{ state: RecommendationState; proposal_hash: string | null }>)[0];
      if (!recommendation) throw new Error('Foresight recommendation not found.');
      assertRecommendationTransition(recommendation.state, 'pending_approval');
      if (recommendation.proposal_hash !== proposalHash) {
        throw new Error('Foresight proposal changed; refresh before requesting approval.');
      }
      await connection.execute(
        `UPDATE foresight_recommendations SET state = 'pending_approval'
         WHERE business_id = ? AND id = ?`,
        [businessId, recommendationId],
      );
      await connection.execute(
        `INSERT INTO foresight_recommendation_events
           (business_id, recommendation_id, from_state, to_state, proposal_hash, actor_id, reason_code, note)
         VALUES (?, ?, 'shadow', 'pending_approval', ?, ?, ?, ?)`,
        [businessId, recommendationId, proposalHash, requestedBy, reasonCode, note ?? null],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async decideRecommendation(
    businessId: string,
    recommendationId: number,
    decision: 'approved' | 'rejected',
    decidedBy: number,
    proposalHash: string | null,
    reasonCode: string,
    note?: string | null,
  ): Promise<void> {
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT state, proposal_hash FROM foresight_recommendations
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [businessId, recommendationId],
      );
      const recommendation = (rows as Array<{ state: RecommendationState; proposal_hash: string | null }>)[0];
      if (!recommendation) throw new Error('Foresight recommendation not found.');
      if (recommendation.state !== 'pending_approval') {
        throw new Error('Only pending Foresight recommendations can be decided.');
      }
      assertRecommendationTransition(recommendation.state, decision);
      if (recommendation.proposal_hash !== proposalHash) {
        throw new Error('Foresight proposal changed; refresh before approving.');
      }
      await connection.execute(
        `UPDATE foresight_recommendations SET state = ?
         WHERE business_id = ? AND id = ?`,
        [decision, businessId, recommendationId],
      );
      await connection.execute(
        `INSERT INTO foresight_approvals
           (business_id, recommendation_id, decision, proposal_hash, decided_by, reason_code, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [businessId, recommendationId, decision, proposalHash, decidedBy, reasonCode, note ?? null],
      );
      await connection.execute(
        `INSERT INTO foresight_recommendation_events
           (business_id, recommendation_id, from_state, to_state, proposal_hash, actor_id, reason_code, note)
         VALUES (?, ?, 'pending_approval', ?, ?, ?, ?, ?)`,
        [businessId, recommendationId, decision, proposalHash, decidedBy, reasonCode, note ?? null],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};
