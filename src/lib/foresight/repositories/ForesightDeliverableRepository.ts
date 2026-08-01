import { getPool, query } from '@/services/MySQLService';
import {
  hashForesightDeliverable,
  parseForesightDeliverableDocument,
  renderForesightDeliverableMarkdown,
  type ForesightDeliverableDocument,
} from '../planning/deliverableDocument';
import { ForesightPlanningRepository, type PlanVersionRow } from './ForesightPlanningRepository';

export type DeliverableReviewAction = 'accepted' | 'rejected' | 'revision_requested';

export interface DeliverableVersionRow {
  id: number;
  business_id: string;
  thread_id: number;
  plan_version_id: number;
  plan_hash: string;
  version: number;
  parent_id: number | null;
  schema_version: number;
  document_json: ForesightDeliverableDocument;
  markdown_text: string;
  document_hash: string;
  model_id: string | null;
  prompt_version: string | null;
  authored_by: number | null;
  change_reason: string | null;
  created_at: string;
}

export interface DeliverableReviewEventRow {
  id: number;
  business_id: string;
  thread_id: number;
  deliverable_version_id: number;
  document_hash: string;
  action: DeliverableReviewAction;
  actor_id: number;
  note: string | null;
  created_at: string;
}

export class DeliverableTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliverableTransitionError';
  }
}

function json<T>(value: T | string): T {
  return typeof value === 'string' ? JSON.parse(value) as T : value;
}

async function acceptedPlan(businessId: string, threadId: number): Promise<PlanVersionRow | null> {
  const plan = await ForesightPlanningRepository.latestPlanVersion(businessId, threadId);
  if (!plan) return null;
  const review = await ForesightPlanningRepository.latestPlanReview(businessId, threadId);
  return review?.action === 'accepted'
    && review.plan_version_id === plan.id
    && review.plan_hash === plan.plan_hash
    ? plan
    : null;
}

export const ForesightDeliverableRepository = {
  acceptedPlan,

  async latest(businessId: string, threadId: number): Promise<DeliverableVersionRow | null> {
    const rows = await query<DeliverableVersionRow>(
      `SELECT deliverable.*
       FROM foresight_deliverable_versions deliverable
       INNER JOIN foresight_planning_threads thread
         ON thread.business_id = deliverable.business_id AND thread.id = deliverable.thread_id
       WHERE deliverable.business_id = ? AND deliverable.thread_id = ?
       ORDER BY deliverable.version DESC LIMIT 1`,
      [businessId, threadId],
    );
    return rows[0] ? { ...rows[0], document_json: json(rows[0].document_json) } : null;
  },

  async latestReview(businessId: string, threadId: number): Promise<DeliverableReviewEventRow | null> {
    const rows = await query<DeliverableReviewEventRow>(
      `SELECT review.*
       FROM foresight_deliverable_review_events review
       INNER JOIN foresight_deliverable_versions deliverable
         ON deliverable.business_id = review.business_id AND deliverable.id = review.deliverable_version_id
       WHERE review.business_id = ? AND review.thread_id = ?
       ORDER BY deliverable.version DESC, review.id DESC LIMIT 1`,
      [businessId, threadId],
    );
    return rows[0] ?? null;
  },

  async createVersion(businessId: string, threadId: number, input: {
    planVersionId: number;
    planHash: string;
    knownFactIds: string[];
    document: unknown;
    modelId: string;
    promptVersion: string;
    authoredBy: number;
    changeReason?: string | null;
  }): Promise<DeliverableVersionRow> {
    const document = parseForesightDeliverableDocument(input.document, {
      planVersionId: input.planVersionId,
      planHash: input.planHash,
      knownFactIds: input.knownFactIds,
    });
    const documentHash = hashForesightDeliverable(document);
    const markdown = renderForesightDeliverableMarkdown(document);
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [planRows] = await connection.execute(
        `SELECT plan.id, plan.plan_hash
         FROM foresight_plan_versions plan
         INNER JOIN foresight_planning_threads thread
           ON thread.business_id = plan.business_id AND thread.id = plan.thread_id
         WHERE plan.business_id = ? AND plan.thread_id = ?
         ORDER BY plan.version DESC LIMIT 1 FOR UPDATE`,
        [businessId, threadId],
      );
      const plan = (planRows as Array<{ id: number; plan_hash: string }>)[0];
      if (!plan || plan.id !== input.planVersionId || plan.plan_hash !== input.planHash) {
        throw new DeliverableTransitionError('Deliverables require the exact latest plan version.');
      }
      const [planReviewRows] = await connection.execute(
        `SELECT action FROM foresight_plan_review_events
         WHERE business_id = ? AND thread_id = ? AND plan_version_id = ? AND plan_hash = ?
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [businessId, threadId, input.planVersionId, input.planHash],
      );
      if ((planReviewRows as Array<{ action: string }>)[0]?.action !== 'accepted') {
        throw new DeliverableTransitionError('The exact source plan must be accepted before drafting deliverables.');
      }
      const [latestRows] = await connection.execute(
        `SELECT deliverable.id, deliverable.version, review.action
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
      const latest = (latestRows as Array<{ id: number; version: number; action: string | null }>)[0];
      if (latest?.action === 'accepted') {
        throw new DeliverableTransitionError('The accepted deliverable package cannot be superseded.');
      }
      if (latest && latest.action !== 'revision_requested' && latest.action !== 'rejected') {
        throw new DeliverableTransitionError('Review the current deliverable package before creating another version.');
      }
      const version = (latest?.version ?? 0) + 1;
      const [result] = await connection.execute(
        `INSERT INTO foresight_deliverable_versions
           (business_id, thread_id, plan_version_id, plan_hash, version, parent_id,
            schema_version, document_json, markdown_text, document_hash, model_id,
            prompt_version, authored_by, change_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          businessId, threadId, input.planVersionId, input.planHash, version, latest?.id ?? null,
          document.schemaVersion, JSON.stringify(document), markdown, documentHash, input.modelId,
          input.promptVersion, input.authoredBy, input.changeReason?.trim() || null,
        ],
      );
      await connection.commit();
      return {
        id: (result as { insertId: number }).insertId,
        business_id: businessId,
        thread_id: threadId,
        plan_version_id: input.planVersionId,
        plan_hash: input.planHash,
        version,
        parent_id: latest?.id ?? null,
        schema_version: document.schemaVersion,
        document_json: document,
        markdown_text: markdown,
        document_hash: documentHash,
        model_id: input.modelId,
        prompt_version: input.promptVersion,
        authored_by: input.authoredBy,
        change_reason: input.changeReason?.trim() || null,
        created_at: new Date().toISOString(),
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async review(businessId: string, threadId: number, input: {
    deliverableVersionId: number;
    documentHash: string;
    action: DeliverableReviewAction;
    actorId: number;
    note?: string | null;
  }): Promise<number> {
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT deliverable.id, deliverable.document_hash, review.action
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
      const deliverable = (rows as Array<{ id: number; document_hash: string; action: string | null }>)[0];
      if (!deliverable || deliverable.id !== input.deliverableVersionId || deliverable.document_hash !== input.documentHash) {
        throw new DeliverableTransitionError('Only the exact latest deliverable version can be reviewed.');
      }
      if (deliverable.action != null) throw new DeliverableTransitionError('This deliverable version already has a decision.');
      const note = input.note?.trim() || null;
      if ((input.action === 'rejected' || input.action === 'revision_requested') && !note) {
        throw new DeliverableTransitionError('A review note is required for rejection or revision requests.');
      }
      const [result] = await connection.execute(
        `INSERT INTO foresight_deliverable_review_events
           (business_id, thread_id, deliverable_version_id, document_hash, action, actor_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [businessId, threadId, input.deliverableVersionId, input.documentHash, input.action, input.actorId, note],
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
};