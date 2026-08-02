import { createHash } from 'node:crypto';
import { execute, getPool, query } from '@/services/MySQLService';
import {
  hashForesightPlan,
  parseForesightPlanDocument,
  renderForesightPlanMarkdown,
  type ForesightPlanDocument,
  type PlanningThreadState,
  type PlanningThreadType,
} from '../planning/planDocument';

export interface PlanningThreadRow {
  id: number;
  business_id: string;
  thread_type: PlanningThreadType;
  state: PlanningThreadState;
  title: string;
  strategy_version_id: number | null;
  created_by: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface PlanningMessageRow {
  id: number;
  business_id: string;
  thread_id: number;
  actor_type: 'human' | 'assistant' | 'system' | 'algorithm';
  actor_user_id: number | null;
  model_id: string | null;
  prompt_version: string | null;
  content: string;
  message_json: Record<string, unknown> | null;
  created_at: string;
}

export interface PlanVersionRow {
  id: number;
  business_id: string;
  thread_id: number;
  version: number;
  parent_id: number | null;
  state: PlanningThreadState;
  schema_version: number;
  plan_json: ForesightPlanDocument;
  markdown_text: string;
  plan_hash: string;
  model_id: string | null;
  prompt_version: string | null;
  tool_manifest_version: string | null;
  authored_by: number | null;
  change_reason: string | null;
  created_at: string;
}

export interface PlanningLinkRow {
  id: number;
  business_id: string;
  thread_id: number;
  plan_version_id: number | null;
  link_type: 'recommendation' | 'initiative' | 'strategy' | 'creative';
  link_id: string;
  created_at: string;
}

export interface PlanningFactSnapshot {
  factId: string;
  label: string;
  source: string;
  authority: 'authoritative' | 'diagnostic' | 'human';
  observedFrom: string | null;
  observedThrough: string | null;
  freshnessAt: string | null;
  quality: Record<string, unknown>;
  value: Record<string, unknown>;
}

export interface PlanValidationRow {
  id: number;
  business_id: string;
  thread_id: number;
  plan_version_id: number;
  plan_hash: string;
  state: 'passed' | 'failed' | 'needs_human';
  findings_json: Record<string, unknown>;
  validator_version: string;
  validated_by: number | null;
  created_at: string;
}

export type PlanReviewAction = 'submitted' | 'accepted' | 'rejected' | 'revision_requested';

export interface PlanReviewEventRow {
  id: number;
  business_id: string;
  thread_id: number;
  plan_version_id: number;
  plan_hash: string;
  action: PlanReviewAction;
  actor_id: number;
  note: string | null;
  created_at: string;
}

export class PlanReviewTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanReviewTransitionError';
  }
}

export class PlanningThreadConflictError extends Error {
  constructor() {
    super('The planning thread changed. Reload it before saving another plan version.');
    this.name = 'PlanningThreadConflictError';
  }
}

function json<T>(value: T | string): T {
  return typeof value === 'string' ? JSON.parse(value) as T : value;
}

function normalizePlanVersion(row: PlanVersionRow): PlanVersionRow {
  return { ...row, plan_json: parseForesightPlanDocument(json(row.plan_json)) };
}

function hashResult(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function planningFactSnapshot(value: unknown): PlanningFactSnapshot | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const fact = value as Record<string, unknown>;
  if (typeof fact.factId !== 'string' || typeof fact.label !== 'string' || typeof fact.source !== 'string') return null;
  if (!['authoritative', 'diagnostic', 'human'].includes(String(fact.authority))) return null;
  if (fact.value == null || typeof fact.value !== 'object' || Array.isArray(fact.value)) return null;
  return {
    factId: fact.factId,
    label: fact.label,
    source: fact.source,
    authority: fact.authority as PlanningFactSnapshot['authority'],
    observedFrom: typeof fact.observedFrom === 'string' ? fact.observedFrom : null,
    observedThrough: typeof fact.observedThrough === 'string' ? fact.observedThrough : null,
    freshnessAt: typeof fact.freshnessAt === 'string' ? fact.freshnessAt : null,
    quality: fact.quality != null && typeof fact.quality === 'object' && !Array.isArray(fact.quality)
      ? fact.quality as Record<string, unknown>
      : {},
    value: fact.value as Record<string, unknown>,
  };
}

export const ForesightPlanningRepository = {
  async createThread(businessId: string, input: {
    threadType: PlanningThreadType;
    title: string;
    createdBy: number;
    strategyVersionId?: number | null;
  }): Promise<number> {
    const result = await execute(
      `INSERT INTO foresight_planning_threads
         (business_id, thread_type, state, title, strategy_version_id, created_by, revision)
       VALUES (?, ?, 'discovering', ?, ?, ?, 1)`,
      [businessId, input.threadType, input.title.trim(), input.strategyVersionId ?? null, input.createdBy],
    );
    return result.insertId;
  },

  async getThread(businessId: string, threadId: number): Promise<PlanningThreadRow | null> {
    const rows = await query<PlanningThreadRow>(
      'SELECT * FROM foresight_planning_threads WHERE business_id = ? AND id = ? LIMIT 1',
      [businessId, threadId],
    );
    return rows[0] ?? null;
  },

  async listThreads(businessId: string, limit = 50): Promise<PlanningThreadRow[]> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    return query<PlanningThreadRow>(
      `SELECT * FROM foresight_planning_threads
       WHERE business_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT ${boundedLimit}`,
      [businessId],
    );
  },

  async listMessages(businessId: string, threadId: number, limit = 100): Promise<PlanningMessageRow[]> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = await query<PlanningMessageRow>(
      `SELECT message.*
       FROM foresight_planning_messages message
       INNER JOIN foresight_planning_threads thread
         ON thread.business_id = message.business_id AND thread.id = message.thread_id
       WHERE message.business_id = ? AND message.thread_id = ?
       ORDER BY message.id ASC LIMIT ${boundedLimit}`,
      [businessId, threadId],
    );
    return rows.map((row) => ({ ...row, message_json: row.message_json == null ? null : json(row.message_json) }));
  },

  async listThreadFacts(businessId: string, threadId: number): Promise<PlanningFactSnapshot[]> {
    const rows = await query<{ result_json: Record<string, unknown> | string }>(
      `SELECT tool.result_json
       FROM foresight_planning_tool_calls tool
       INNER JOIN foresight_planning_threads thread
         ON thread.business_id = tool.business_id AND thread.id = tool.thread_id
       WHERE tool.business_id = ? AND tool.thread_id = ?
         AND tool.state = 'succeeded' AND tool.result_json IS NOT NULL
       ORDER BY tool.id DESC
       LIMIT 100`,
      [businessId, threadId],
    );
    const facts = new Map<string, PlanningFactSnapshot>();
    for (const row of [...rows].reverse()) {
      try {
        const result = json<Record<string, unknown>>(row.result_json);
        if (!Array.isArray(result.facts)) continue;
        for (const value of result.facts) {
          const fact = planningFactSnapshot(value);
          if (fact) facts.set(fact.factId, fact);
        }
      } catch {
        continue;
      }
    }
    return [...facts.values()];
  },

  async appendMessage(businessId: string, threadId: number, input: {
    actorType: PlanningMessageRow['actor_type'];
    content: string;
    actorUserId?: number | null;
    modelId?: string | null;
    promptVersion?: string | null;
    message?: Record<string, unknown> | null;
  }): Promise<number> {
    const result = await execute(
      `INSERT INTO foresight_planning_messages
         (business_id, thread_id, actor_type, actor_user_id, model_id, prompt_version, content, message_json)
       SELECT ?, thread.id, ?, ?, ?, ?, ?, ?
       FROM foresight_planning_threads thread
       WHERE thread.business_id = ? AND thread.id = ?`,
      [
        businessId,
        input.actorType,
        input.actorUserId ?? null,
        input.modelId ?? null,
        input.promptVersion ?? null,
        input.content.trim(),
        input.message ? JSON.stringify(input.message) : null,
        businessId,
        threadId,
      ],
    );
    if (result.affectedRows !== 1) throw new Error('Planning thread not found.');
    return result.insertId;
  },

  async appendHumanMessage(businessId: string, threadId: number, expectedRevision: number, input: {
    actorUserId: number;
    content: string;
  }): Promise<{ messageId: number; threadRevision: number }> {
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [threadRows] = await connection.execute(
        `SELECT revision FROM foresight_planning_threads
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [businessId, threadId],
      );
      const thread = (threadRows as Array<{ revision: number }>)[0];
      if (!thread) throw new Error('Planning thread not found.');
      if (thread.revision !== expectedRevision) throw new PlanningThreadConflictError();
      const [messageResult] = await connection.execute(
        `INSERT INTO foresight_planning_messages
           (business_id, thread_id, actor_type, actor_user_id, content)
         VALUES (?, ?, 'human', ?, ?)`,
        [businessId, threadId, input.actorUserId, input.content.trim()],
      );
      const nextRevision = thread.revision + 1;
      await connection.execute(
        `UPDATE foresight_planning_threads
         SET revision = ?, updated_at = CURRENT_TIMESTAMP
         WHERE business_id = ? AND id = ? AND revision = ?`,
        [nextRevision, businessId, threadId, expectedRevision],
      );
      await connection.commit();
      return {
        messageId: (messageResult as { insertId: number }).insertId,
        threadRevision: nextRevision,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async appendAssistantMessage(businessId: string, threadId: number, expectedRevision: number, input: {
    content: string;
    modelId: string;
    promptVersion: string;
    message: Record<string, unknown>;
  }): Promise<{ messageId: number; threadRevision: number }> {
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [threadRows] = await connection.execute(
        `SELECT revision FROM foresight_planning_threads
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [businessId, threadId],
      );
      const thread = (threadRows as Array<{ revision: number }>)[0];
      if (!thread) throw new Error('Planning thread not found.');
      if (thread.revision !== expectedRevision) throw new PlanningThreadConflictError();
      const [messageResult] = await connection.execute(
        `INSERT INTO foresight_planning_messages
           (business_id, thread_id, actor_type, model_id, prompt_version, content, message_json)
         VALUES (?, ?, 'assistant', ?, ?, ?, ?)`,
        [
          businessId, threadId, input.modelId, input.promptVersion,
          input.content.trim(), JSON.stringify(input.message),
        ],
      );
      const nextRevision = thread.revision + 1;
      await connection.execute(
        `UPDATE foresight_planning_threads
         SET revision = ?, updated_at = CURRENT_TIMESTAMP
         WHERE business_id = ? AND id = ? AND revision = ?`,
        [nextRevision, businessId, threadId, expectedRevision],
      );
      await connection.commit();
      return {
        messageId: (messageResult as { insertId: number }).insertId,
        threadRevision: nextRevision,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async createPlanVersion(businessId: string, threadId: number, expectedRevision: number, input: {
    plan: unknown;
    state?: Extract<PlanningThreadState, 'drafting' | 'ready_for_validation'>;
    authoredBy?: number | null;
    modelId?: string | null;
    promptVersion?: string | null;
    toolManifestVersion?: string | null;
    changeReason?: string | null;
  }): Promise<{ id: number; version: number; planHash: string; markdown: string; threadRevision: number }> {
    const plan = parseForesightPlanDocument(input.plan);
    const planHash = hashForesightPlan(plan);
    const markdown = renderForesightPlanMarkdown(plan);
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [threadRows] = await connection.execute(
        `SELECT revision, state FROM foresight_planning_threads
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [businessId, threadId],
      );
      const thread = (threadRows as Array<{ revision: number; state: PlanningThreadState }>)[0];
      if (!thread) throw new Error('Planning thread not found.');
      if (thread.revision !== expectedRevision) throw new PlanningThreadConflictError();
      if (thread.state === 'locked_for_approval' || thread.state === 'approved') {
        throw new PlanReviewTransitionError('The current plan is locked for review and cannot be superseded.');
      }
      const [versionRows] = await connection.execute(
        `SELECT id, version FROM foresight_plan_versions
         WHERE business_id = ? AND thread_id = ? ORDER BY version DESC LIMIT 1`,
        [businessId, threadId],
      );
      const latest = (versionRows as Array<{ id: number; version: number }>)[0];
      const version = (latest?.version ?? 0) + 1;
      const state = input.state ?? 'drafting';
      const [result] = await connection.execute(
        `INSERT INTO foresight_plan_versions
           (business_id, thread_id, version, parent_id, state, schema_version, plan_json,
            markdown_text, plan_hash, model_id, prompt_version, tool_manifest_version,
            authored_by, change_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          businessId, threadId, version, latest?.id ?? null, state, plan.schemaVersion,
          JSON.stringify(plan), markdown, planHash, input.modelId ?? null,
          input.promptVersion ?? null, input.toolManifestVersion ?? null,
          input.authoredBy ?? null, input.changeReason ?? null,
        ],
      );
      const nextRevision = thread.revision + 1;
      await connection.execute(
        `UPDATE foresight_planning_threads
         SET state = ?, revision = ?, updated_at = CURRENT_TIMESTAMP
         WHERE business_id = ? AND id = ? AND revision = ?`,
        [state, nextRevision, businessId, threadId, expectedRevision],
      );
      await connection.commit();
      return {
        id: (result as { insertId: number }).insertId,
        version,
        planHash,
        markdown,
        threadRevision: nextRevision,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async latestPlanVersion(businessId: string, threadId: number): Promise<PlanVersionRow | null> {
    const rows = await query<PlanVersionRow>(
      `SELECT * FROM foresight_plan_versions
       WHERE business_id = ? AND thread_id = ? ORDER BY version DESC LIMIT 1`,
      [businessId, threadId],
    );
    return rows[0] ? normalizePlanVersion(rows[0]) : null;
  },

  async latestPlanValidation(businessId: string, threadId: number): Promise<PlanValidationRow | null> {
    const rows = await query<PlanValidationRow>(
      `SELECT validation.*
       FROM foresight_plan_validations validation
       INNER JOIN foresight_plan_versions plan
         ON plan.business_id = validation.business_id AND plan.id = validation.plan_version_id
       WHERE validation.business_id = ? AND validation.thread_id = ?
       ORDER BY plan.version DESC, validation.id DESC
       LIMIT 1`,
      [businessId, threadId],
    );
    return rows[0] ? { ...rows[0], findings_json: json(rows[0].findings_json) } : null;
  },

  async latestPlanReview(businessId: string, threadId: number): Promise<PlanReviewEventRow | null> {
    const rows = await query<PlanReviewEventRow>(
      `SELECT review.*
       FROM foresight_plan_review_events review
       INNER JOIN foresight_plan_versions plan
         ON plan.business_id = review.business_id AND plan.id = review.plan_version_id
       WHERE review.business_id = ? AND review.thread_id = ?
       ORDER BY plan.version DESC, review.id DESC
       LIMIT 1`,
      [businessId, threadId],
    );
    return rows[0] ?? null;
  },

  async reviewPlan(businessId: string, threadId: number, expectedRevision: number, input: {
    planVersionId: number;
    planHash: string;
    action: PlanReviewAction;
    actorId: number;
    note?: string | null;
  }): Promise<{ eventId: number; threadRevision: number; threadState: PlanningThreadState }> {
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [threadRows] = await connection.execute(
        `SELECT revision FROM foresight_planning_threads
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [businessId, threadId],
      );
      const thread = (threadRows as Array<{ revision: number }>)[0];
      if (!thread) throw new Error('Planning thread not found.');
      if (thread.revision !== expectedRevision) throw new PlanningThreadConflictError();
      const [planRows] = await connection.execute(
        `SELECT id, plan_hash FROM foresight_plan_versions
         WHERE business_id = ? AND thread_id = ?
         ORDER BY version DESC LIMIT 1 FOR UPDATE`,
        [businessId, threadId],
      );
      const plan = (planRows as Array<{ id: number; plan_hash: string }>)[0];
      if (!plan || plan.id !== input.planVersionId || plan.plan_hash !== input.planHash) {
        throw new PlanReviewTransitionError('Only the exact latest plan version can be reviewed.');
      }
      const [reviewRows] = await connection.execute(
        `SELECT action FROM foresight_plan_review_events
         WHERE business_id = ? AND thread_id = ? AND plan_version_id = ?
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [businessId, threadId, input.planVersionId],
      );
      const previousAction = (reviewRows as Array<{ action: PlanReviewAction }>)[0]?.action ?? null;
      let threadState: PlanningThreadState;
      if (input.action === 'submitted') {
        if (previousAction != null) throw new PlanReviewTransitionError('This plan version has already entered review.');
        const [validationRows] = await connection.execute(
          `SELECT state FROM foresight_plan_validations
           WHERE business_id = ? AND thread_id = ? AND plan_version_id = ? AND plan_hash = ?
           ORDER BY id DESC LIMIT 1 FOR UPDATE`,
          [businessId, threadId, input.planVersionId, input.planHash],
        );
        const validation = (validationRows as Array<{ state: PlanValidationRow['state'] }>)[0];
        if (validation?.state !== 'passed') {
          throw new PlanReviewTransitionError('The exact plan version must pass deterministic validation before review.');
        }
        threadState = 'locked_for_approval';
      } else {
        if (previousAction !== 'submitted') {
          throw new PlanReviewTransitionError('A submitted plan is required before recording a review decision.');
        }
        threadState = input.action === 'accepted'
          ? 'approved'
          : input.action === 'rejected'
            ? 'rejected'
            : 'drafting';
      }
      const note = input.note?.trim() || null;
      if ((input.action === 'rejected' || input.action === 'revision_requested') && !note) {
        throw new PlanReviewTransitionError('A review note is required for rejection or revision requests.');
      }
      const [eventResult] = await connection.execute(
        `INSERT INTO foresight_plan_review_events
           (business_id, thread_id, plan_version_id, plan_hash, action, actor_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [businessId, threadId, input.planVersionId, input.planHash, input.action, input.actorId, note],
      );
      const nextRevision = thread.revision + 1;
      await connection.execute(
        `UPDATE foresight_planning_threads
         SET state = ?, revision = ?, updated_at = CURRENT_TIMESTAMP
         WHERE business_id = ? AND id = ? AND revision = ?`,
        [threadState, nextRevision, businessId, threadId, expectedRevision],
      );
      await connection.commit();
      return {
        eventId: (eventResult as { insertId: number }).insertId,
        threadRevision: nextRevision,
        threadState,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async listThreadLinks(businessId: string, threadId: number): Promise<PlanningLinkRow[]> {
    return query<PlanningLinkRow>(
      `SELECT link.*
       FROM foresight_plan_links link
       INNER JOIN foresight_planning_threads thread
         ON thread.business_id = link.business_id AND thread.id = link.thread_id
       WHERE link.business_id = ? AND link.thread_id = ?
       ORDER BY link.created_at ASC, link.id ASC`,
      [businessId, threadId],
    );
  },

  async findThreadForLink(
    businessId: string,
    linkType: PlanningLinkRow['link_type'],
    linkId: string,
  ): Promise<PlanningThreadRow | null> {
    const rows = await query<PlanningThreadRow>(
      `SELECT thread.*
       FROM foresight_plan_links link
       INNER JOIN foresight_planning_threads thread
         ON thread.business_id = link.business_id AND thread.id = link.thread_id
       WHERE link.business_id = ? AND link.link_type = ? AND link.link_id = ?
       ORDER BY thread.updated_at DESC, thread.id DESC
       LIMIT 1`,
      [businessId, linkType, linkId],
    );
    return rows[0] ?? null;
  },

  async getOrCreateRecommendationThread(businessId: string, recommendationId: number, input: {
    title: string;
    createdBy: number;
    systemContent: string;
    systemMessage: Record<string, unknown>;
  }): Promise<{ threadId: number; created: boolean }> {
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [recommendationRows] = await connection.execute(
        `SELECT id FROM foresight_recommendations
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [businessId, recommendationId],
      );
      if (!(recommendationRows as Array<{ id: number }>)[0]) throw new Error('Recommendation not found.');
      const [threadRows] = await connection.execute(
        `SELECT thread.id
         FROM foresight_plan_links link
         INNER JOIN foresight_planning_threads thread
           ON thread.business_id = link.business_id AND thread.id = link.thread_id
         WHERE link.business_id = ? AND link.link_type = 'recommendation' AND link.link_id = ?
         ORDER BY thread.updated_at DESC, thread.id DESC LIMIT 1`,
        [businessId, String(recommendationId)],
      );
      const existing = (threadRows as Array<{ id: number }>)[0];
      if (existing) {
        await connection.commit();
        return { threadId: existing.id, created: false };
      }
      const [threadResult] = await connection.execute(
        `INSERT INTO foresight_planning_threads
           (business_id, thread_type, state, title, created_by, revision)
         VALUES (?, 'recommendation', 'discovering', ?, ?, 1)`,
        [businessId, input.title.trim(), input.createdBy],
      );
      const threadId = (threadResult as { insertId: number }).insertId;
      await connection.execute(
        `INSERT INTO foresight_plan_links
           (business_id, thread_id, link_type, link_id)
         VALUES (?, ?, 'recommendation', ?)`,
        [businessId, threadId, String(recommendationId)],
      );
      await connection.execute(
        `INSERT INTO foresight_planning_messages
           (business_id, thread_id, actor_type, content, message_json)
         VALUES (?, ?, 'system', ?, ?)`,
        [businessId, threadId, input.systemContent.trim(), JSON.stringify(input.systemMessage)],
      );
      await connection.commit();
      return { threadId, created: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async linkThread(businessId: string, threadId: number, input: {
    linkType: PlanningLinkRow['link_type'];
    linkId: string;
    planVersionId?: number | null;
  }): Promise<number> {
    const result = await execute(
      `INSERT INTO foresight_plan_links
         (business_id, thread_id, plan_version_id, link_type, link_id)
       SELECT ?, thread.id, ?, ?, ?
       FROM foresight_planning_threads thread
       WHERE thread.business_id = ? AND thread.id = ?
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), plan_version_id = VALUES(plan_version_id)`,
      [businessId, input.planVersionId ?? null, input.linkType, input.linkId, businessId, threadId],
    );
    if (result.affectedRows < 1) throw new Error('Planning thread not found.');
    return result.insertId;
  },

  async startToolCall(businessId: string, threadId: number, input: {
    toolName: string;
    arguments: Record<string, unknown>;
    messageId?: number | null;
  }): Promise<number> {
    const result = await execute(
      `INSERT INTO foresight_planning_tool_calls
         (business_id, thread_id, message_id, tool_name, arguments_json, state)
       SELECT ?, thread.id, ?, ?, ?, 'running'
       FROM foresight_planning_threads thread
       WHERE thread.business_id = ? AND thread.id = ?`,
      [businessId, input.messageId ?? null, input.toolName, JSON.stringify(input.arguments), businessId, threadId],
    );
    if (result.affectedRows !== 1) throw new Error('Planning thread not found.');
    return result.insertId;
  },

  async completeToolCall(businessId: string, toolCallId: number, input: {
    state: 'succeeded' | 'failed';
    result?: Record<string, unknown> | null;
    factIds?: string[];
    errorText?: string | null;
    durationMs: number;
  }): Promise<void> {
    const resultJson = input.result ? JSON.stringify(input.result) : null;
    const result = await execute(
      `UPDATE foresight_planning_tool_calls
       SET state = ?, result_json = ?, result_hash = ?, fact_ids_json = ?, error_text = ?,
           duration_ms = ?, completed_at = CURRENT_TIMESTAMP
       WHERE business_id = ? AND id = ? AND state = 'running'`,
      [
        input.state, resultJson, input.result ? hashResult(input.result) : null,
        JSON.stringify(input.factIds ?? []), input.errorText ?? null,
        Math.max(0, Math.trunc(input.durationMs)), businessId, toolCallId,
      ],
    );
    if (result.affectedRows !== 1) throw new Error('Running planning tool call not found.');
  },

  async recordValidation(businessId: string, input: {
    threadId: number;
    planVersionId: number;
    planHash: string;
    state: 'passed' | 'failed' | 'needs_human';
    findings: Record<string, unknown>;
    validatorVersion: string;
    validatedBy?: number | null;
  }): Promise<number> {
    const result = await execute(
      `INSERT INTO foresight_plan_validations
         (business_id, thread_id, plan_version_id, plan_hash, state, findings_json,
          validator_version, validated_by)
       SELECT ?, plan.thread_id, plan.id, ?, ?, ?, ?, ?
       FROM foresight_plan_versions plan
       WHERE plan.business_id = ? AND plan.thread_id = ? AND plan.id = ? AND plan.plan_hash = ?`,
      [
        businessId, input.planHash, input.state, JSON.stringify(input.findings),
        input.validatorVersion, input.validatedBy ?? null,
        businessId, input.threadId, input.planVersionId, input.planHash,
      ],
    );
    if (result.affectedRows !== 1) throw new Error('Matching plan version not found.');
    return result.insertId;
  },
};