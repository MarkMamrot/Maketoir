import { createHash } from 'node:crypto';
import { execute, getPool, query } from '@/services/MySQLService';
import { assertRecommendationTransition } from '../recommendationState';
import type { ForesightChannel, RecommendationEvidence, RecommendationState } from '../types';

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
