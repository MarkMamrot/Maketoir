import { getPool, query } from '@/services/MySQLService';
import {
  hashCreativeBrief,
  parseCreativeBriefDocument,
  parseCreativeReviewHumanContext,
  renderCreativeBriefMarkdown,
  type CreativeBriefDocument,
  type CreativeReviewHumanContext,
} from '../creative/creativeBrief';
import { PlanningThreadConflictError, type PlanningMessageRow, type PlanningThreadRow } from './ForesightPlanningRepository';

export interface CreativeBriefVersionRow {
  id: number;
  business_id: string;
  thread_id: number;
  creative_id: number;
  assessment_id: number;
  diagnostics_through: string;
  version: number;
  parent_id: number | null;
  schema_version: number;
  document_json: CreativeBriefDocument;
  markdown_text: string;
  document_hash: string;
  model_id: string | null;
  prompt_version: string | null;
  prompt_hash: string | null;
  authored_by: number | null;
  change_reason: string | null;
  created_at: string;
}

export class CreativeBriefTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreativeBriefTransitionError';
  }
}

function json<T>(value: T | string): T {
  return typeof value === 'string' ? JSON.parse(value) as T : value;
}

function normalize(row: CreativeBriefVersionRow): CreativeBriefVersionRow {
  return { ...row, diagnostics_through: String(row.diagnostics_through).slice(0, 10), document_json: json(row.document_json) };
}

export const ForesightCreativeBriefRepository = {
  async getOrCreateReviewThread(businessId: string, creativeId: number, input: {
    title: string; createdBy: number;
  }): Promise<{ threadId: number; created: boolean }> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [creativeRows] = await connection.execute(
        'SELECT id FROM foresight_creatives WHERE business_id = ? AND id = ? FOR UPDATE',
        [businessId, creativeId],
      );
      if (!(creativeRows as Array<{ id: number }>)[0]) throw new CreativeBriefTransitionError('Creative not found.');
      const [threadRows] = await connection.execute(
        `SELECT thread.id FROM foresight_plan_links link
         INNER JOIN foresight_planning_threads thread
           ON thread.business_id = link.business_id AND thread.id = link.thread_id
         WHERE link.business_id = ? AND link.link_type = 'creative' AND link.link_id = ?
         ORDER BY thread.id DESC LIMIT 1`,
        [businessId, String(creativeId)],
      );
      const existing = (threadRows as Array<{ id: number }>)[0];
      if (existing) {
        await connection.commit();
        return { threadId: existing.id, created: false };
      }
      const [threadResult] = await connection.execute(
        `INSERT INTO foresight_planning_threads
           (business_id, thread_type, state, title, created_by, revision)
         VALUES (?, 'initiative', 'discovering', ?, ?, 1)`,
        [businessId, input.title.trim(), input.createdBy],
      );
      const threadId = (threadResult as { insertId: number }).insertId;
      await connection.execute(
        `INSERT INTO foresight_plan_links (business_id, thread_id, link_type, link_id)
         VALUES (?, ?, 'creative', ?)`,
        [businessId, threadId, String(creativeId)],
      );
      await connection.execute(
        `INSERT INTO foresight_planning_messages
           (business_id, thread_id, actor_type, content, message_json)
         VALUES (?, ?, 'system', ?, ?)`,
        [businessId, threadId,
          'Creative Review is advisory. Platform performance is diagnostic, not causal, and no brief authorizes publication or platform mutation.',
          JSON.stringify({ contextType: 'creative_review_guardrail', creativeId })],
      );
      await connection.execute(
        `INSERT INTO foresight_planning_messages
           (business_id, thread_id, actor_type, content, message_json)
         VALUES (?, ?, 'assistant', ?, ?)`,
        [businessId, threadId,
          'Before I draft a brief, tell me the intended audience, intended message, offer or absence of an offer, and relevant offline context.',
          JSON.stringify({ contextType: 'creative_review_questions', questions: [
            'Who is the intended audience?', 'What single message should they take away?',
            'What offer applies, or is there deliberately no offer?', 'What offline or external context should affect interpretation?',
          ] })],
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

  async getThread(businessId: string, creativeId: number): Promise<PlanningThreadRow | null> {
    const rows = await query<PlanningThreadRow>(
      `SELECT thread.* FROM foresight_plan_links link
       INNER JOIN foresight_planning_threads thread
         ON thread.business_id = link.business_id AND thread.id = link.thread_id
       WHERE link.business_id = ? AND link.link_type = 'creative' AND link.link_id = ?
       ORDER BY thread.id DESC LIMIT 1`,
      [businessId, String(creativeId)],
    );
    return rows[0] ?? null;
  },

  async listMessages(businessId: string, threadId: number): Promise<PlanningMessageRow[]> {
    const rows = await query<PlanningMessageRow>(
      `SELECT message.* FROM foresight_planning_messages message
       INNER JOIN foresight_planning_threads thread
         ON thread.business_id = message.business_id AND thread.id = message.thread_id
       WHERE message.business_id = ? AND message.thread_id = ? ORDER BY message.id ASC LIMIT 200`,
      [businessId, threadId],
    );
    return rows.map((row) => ({ ...row, message_json: row.message_json == null ? null : json(row.message_json) }));
  },

  async latestHumanContext(businessId: string, threadId: number): Promise<CreativeReviewHumanContext | null> {
    const rows = await query<{ message_json: Record<string, unknown> | string }>(
      `SELECT message.message_json FROM foresight_planning_messages message
       INNER JOIN foresight_planning_threads thread
         ON thread.business_id = message.business_id AND thread.id = message.thread_id
       WHERE message.business_id = ? AND message.thread_id = ? AND message.actor_type = 'human'
         AND JSON_UNQUOTE(JSON_EXTRACT(message.message_json, '$.contextType')) = 'creative_review_human_context'
       ORDER BY message.id DESC LIMIT 1`,
      [businessId, threadId],
    );
    if (!rows[0]) return null;
    const message = json<Record<string, unknown>>(rows[0].message_json);
    return parseCreativeReviewHumanContext(message.context);
  },

  async recordHumanContext(businessId: string, creativeId: number, threadId: number, expectedRevision: number, input: {
    actorUserId: number; context: unknown;
  }): Promise<number> {
    const context = parseCreativeReviewHumanContext(input.context);
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [threadRows] = await connection.execute(
        `SELECT thread.revision FROM foresight_planning_threads thread
         INNER JOIN foresight_plan_links link
           ON link.business_id = thread.business_id AND link.thread_id = thread.id
         WHERE thread.business_id = ? AND thread.id = ? AND link.link_type = 'creative' AND link.link_id = ? FOR UPDATE`,
        [businessId, threadId, String(creativeId)],
      );
      const thread = (threadRows as Array<{ revision: number }>)[0];
      if (!thread) throw new CreativeBriefTransitionError('Creative Review thread not found.');
      if (thread.revision !== expectedRevision) throw new PlanningThreadConflictError();
      await connection.execute(
        `INSERT INTO foresight_planning_messages
           (business_id, thread_id, actor_type, actor_user_id, content, message_json)
         VALUES (?, ?, 'human', ?, ?, ?)`,
        [businessId, threadId, input.actorUserId,
          `Audience: ${context.intendedAudience}\nMessage: ${context.intendedMessage}\nOffer: ${context.offer}\nOffline context: ${context.offlineContext}`,
          JSON.stringify({ contextType: 'creative_review_human_context', context })],
      );
      const nextRevision = thread.revision + 1;
      await connection.execute(
        `UPDATE foresight_planning_threads SET revision = ?, state = 'drafting', updated_at = CURRENT_TIMESTAMP
         WHERE business_id = ? AND id = ? AND revision = ?`,
        [nextRevision, businessId, threadId, expectedRevision],
      );
      await connection.commit();
      return nextRevision;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async latest(businessId: string, creativeId: number): Promise<CreativeBriefVersionRow | null> {
    const rows = await query<CreativeBriefVersionRow>(
      `SELECT brief.* FROM foresight_creative_brief_versions brief
       INNER JOIN foresight_creatives creative
         ON creative.business_id = brief.business_id AND creative.id = brief.creative_id
       WHERE brief.business_id = ? AND brief.creative_id = ? ORDER BY brief.version DESC LIMIT 1`,
      [businessId, creativeId],
    );
    return rows[0] ? normalize(rows[0]) : null;
  },

  async createVersion(businessId: string, threadId: number, expectedRevision: number, input: {
    creativeId: number; assessmentId: number; diagnosticsThrough: string; humanContext: CreativeReviewHumanContext;
    document: unknown; modelId: string; promptVersion: string; promptHash: string; authoredBy: number; changeReason: string;
  }): Promise<CreativeBriefVersionRow> {
    const document = parseCreativeBriefDocument(input.document, {
      creativeId: input.creativeId, assessmentId: input.assessmentId,
      diagnosticsThrough: input.diagnosticsThrough, humanContext: input.humanContext,
    });
    const documentHash = hashCreativeBrief(document);
    const markdown = renderCreativeBriefMarkdown(document);
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [ownerRows] = await connection.execute(
        `SELECT thread.revision,
                (SELECT assessment.id FROM foresight_creative_assessments assessment
                 WHERE assessment.business_id = creative.business_id AND assessment.creative_id = creative.id
                 ORDER BY assessment.id DESC LIMIT 1) AS assessment_id
         FROM foresight_planning_threads thread
         INNER JOIN foresight_plan_links link
           ON link.business_id = thread.business_id AND link.thread_id = thread.id
         INNER JOIN foresight_creatives creative
           ON creative.business_id = link.business_id AND creative.id = CAST(link.link_id AS UNSIGNED)
         WHERE thread.business_id = ? AND thread.id = ? AND link.link_type = 'creative' AND creative.id = ? FOR UPDATE`,
        [businessId, threadId, input.creativeId],
      );
      const owner = (ownerRows as Array<{ revision: number; assessment_id: number | null }>)[0];
      if (!owner) throw new CreativeBriefTransitionError('Creative Review thread not found.');
      if (owner.revision !== expectedRevision) throw new PlanningThreadConflictError();
      if (owner.assessment_id !== input.assessmentId) throw new CreativeBriefTransitionError('The creative assessment changed; refresh before drafting the brief.');
      const [latestRows] = await connection.execute(
        `SELECT * FROM foresight_creative_brief_versions
         WHERE business_id = ? AND thread_id = ? ORDER BY version DESC LIMIT 1 FOR UPDATE`,
        [businessId, threadId],
      );
      const latest = (latestRows as CreativeBriefVersionRow[])[0];
      if (latest?.document_hash === documentHash) {
        await connection.commit();
        return normalize(latest);
      }
      const version = (latest?.version ?? 0) + 1;
      const [result] = await connection.execute(
        `INSERT INTO foresight_creative_brief_versions
           (business_id, thread_id, creative_id, assessment_id, diagnostics_through, version, parent_id,
            schema_version, document_json, markdown_text, document_hash, model_id, prompt_version,
            prompt_hash, authored_by, change_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [businessId, threadId, input.creativeId, input.assessmentId, input.diagnosticsThrough, version,
          latest?.id ?? null, JSON.stringify(document), markdown, documentHash, input.modelId,
          input.promptVersion, input.promptHash, input.authoredBy, input.changeReason.trim()],
      );
      await connection.commit();
      return {
        id: (result as { insertId: number }).insertId, business_id: businessId, thread_id: threadId,
        creative_id: input.creativeId, assessment_id: input.assessmentId, diagnostics_through: input.diagnosticsThrough,
        version, parent_id: latest?.id ?? null, schema_version: 1, document_json: document, markdown_text: markdown,
        document_hash: documentHash, model_id: input.modelId, prompt_version: input.promptVersion,
        prompt_hash: input.promptHash, authored_by: input.authoredBy, change_reason: input.changeReason.trim(),
        created_at: new Date().toISOString(),
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};
