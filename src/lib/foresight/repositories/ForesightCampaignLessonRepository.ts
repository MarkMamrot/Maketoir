import { getPool, query } from '@/services/MySQLService';
import {
  hashForesightCampaignLesson,
  parseForesightCampaignLessonDocument,
  type ForesightCampaignLessonDocument,
} from '../planning/campaignLessonDocument';

export type CampaignLessonReviewAction = 'accepted' | 'rejected' | 'revision_requested';

export interface CampaignLessonVersionRow {
  id: number; business_id: string; thread_id: number; outcome_id: number; activation_id: number;
  version: number; parent_id: number | null; schema_version: number;
  lesson_json: ForesightCampaignLessonDocument; lesson_hash: string; model_id: string | null;
  prompt_version: string | null; authored_by: number; change_reason: string | null; created_at: string;
}

export interface CampaignLessonReviewRow {
  id: number; business_id: string; thread_id: number; lesson_version_id: number;
  lesson_hash: string; action: CampaignLessonReviewAction; actor_id: number; note: string | null; created_at: string;
}

export interface AcceptedCampaignLessonRow extends CampaignLessonVersionRow {
  accepted_at: string; accepted_by: number; review_note: string | null;
}

export class CampaignLessonTransitionError extends Error {
  constructor(message: string) { super(message); this.name = 'CampaignLessonTransitionError'; }
}

function json<T>(value: T | string): T { return typeof value === 'string' ? JSON.parse(value) as T : value; }

export const ForesightCampaignLessonRepository = {
  async listAccepted(businessId: string, input: { from: string; to: string; limit: number }): Promise<AcceptedCampaignLessonRow[]> {
    const rows = await query<AcceptedCampaignLessonRow>(
      `SELECT lesson.*, review.created_at AS accepted_at, review.actor_id AS accepted_by, review.note AS review_note
       FROM foresight_campaign_lesson_versions lesson
       INNER JOIN foresight_campaign_lesson_review_events review
         ON review.business_id = lesson.business_id AND review.lesson_version_id = lesson.id
        AND review.lesson_hash = lesson.lesson_hash AND review.action = 'accepted'
       WHERE lesson.business_id = ? AND DATE(review.created_at) BETWEEN ? AND ?
       ORDER BY review.created_at DESC, lesson.id DESC LIMIT ?`,
      [businessId, input.from, input.to, input.limit],
    );
    return rows.map((row) => ({ ...row, lesson_json: json(row.lesson_json) }));
  },

  async latest(businessId: string, threadId: number): Promise<CampaignLessonVersionRow | null> {
    const rows = await query<CampaignLessonVersionRow>(
      `SELECT * FROM foresight_campaign_lesson_versions
       WHERE business_id = ? AND thread_id = ? ORDER BY version DESC LIMIT 1`,
      [businessId, threadId],
    );
    return rows[0] ? { ...rows[0], lesson_json: json(rows[0].lesson_json) } : null;
  },

  async latestReview(businessId: string, threadId: number): Promise<CampaignLessonReviewRow | null> {
    const rows = await query<CampaignLessonReviewRow>(
      `SELECT review.* FROM foresight_campaign_lesson_review_events review
       INNER JOIN foresight_campaign_lesson_versions lesson
         ON lesson.business_id = review.business_id AND lesson.id = review.lesson_version_id
       WHERE review.business_id = ? AND review.thread_id = ?
       ORDER BY lesson.version DESC, review.id DESC LIMIT 1`,
      [businessId, threadId],
    );
    return rows[0] ?? null;
  },

  async createVersion(businessId: string, threadId: number, input: {
    outcomeId: number; activationId: number; document: unknown; modelId: string;
    promptVersion: string; authoredBy: number; changeReason?: string | null;
  }): Promise<CampaignLessonVersionRow> {
    const outcomeFactId = `foresight:campaign-outcome:${input.outcomeId}:activation:${input.activationId}`;
    const document = parseForesightCampaignLessonDocument(input.document, {
      outcomeId: input.outcomeId, activationId: input.activationId, outcomeFactId,
    });
    const lessonHash = hashForesightCampaignLesson(document);
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [outcomeRows] = await connection.execute(
        `SELECT outcome.id, outcome.activation_id, outcome.thread_id
         FROM foresight_campaign_activation_outcomes outcome
         INNER JOIN foresight_campaign_activations activation
           ON activation.business_id = outcome.business_id AND activation.id = outcome.activation_id
         WHERE outcome.business_id = ? AND outcome.id = ? AND outcome.thread_id = ? FOR UPDATE`,
        [businessId, input.outcomeId, threadId],
      );
      const outcome = (outcomeRows as Array<{ id: number; activation_id: number; thread_id: number }>)[0];
      if (!outcome || outcome.activation_id !== input.activationId) {
        throw new CampaignLessonTransitionError('Lesson requires the exact tenant campaign outcome and activation.');
      }
      const [latestRows] = await connection.execute(
        `SELECT lesson.id, lesson.version, review.action
         FROM foresight_campaign_lesson_versions lesson
         LEFT JOIN foresight_campaign_lesson_review_events review
           ON review.business_id = lesson.business_id AND review.lesson_version_id = lesson.id
          AND review.id = (SELECT MAX(r.id) FROM foresight_campaign_lesson_review_events r
                           WHERE r.business_id = lesson.business_id AND r.lesson_version_id = lesson.id)
         WHERE lesson.business_id = ? AND lesson.outcome_id = ?
         ORDER BY lesson.version DESC LIMIT 1 FOR UPDATE`,
        [businessId, input.outcomeId],
      );
      const latest = (latestRows as Array<{ id: number; version: number; action: string | null }>)[0];
      if (latest?.action === 'accepted') throw new CampaignLessonTransitionError('An accepted campaign lesson cannot be superseded.');
      if (latest && latest.action !== 'rejected' && latest.action !== 'revision_requested') {
        throw new CampaignLessonTransitionError('Review the current campaign lesson before drafting another version.');
      }
      const version = (latest?.version ?? 0) + 1;
      const [result] = await connection.execute(
        `INSERT INTO foresight_campaign_lesson_versions
           (business_id, thread_id, outcome_id, activation_id, version, parent_id, schema_version,
            lesson_json, lesson_hash, model_id, prompt_version, authored_by, change_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [businessId, threadId, input.outcomeId, input.activationId, version, latest?.id ?? null, 1,
          JSON.stringify(document), lessonHash, input.modelId, input.promptVersion, input.authoredBy,
          input.changeReason?.trim() || null],
      );
      await connection.commit();
      return { id: (result as { insertId: number }).insertId, business_id: businessId, thread_id: threadId,
        outcome_id: input.outcomeId, activation_id: input.activationId, version, parent_id: latest?.id ?? null,
        schema_version: 1, lesson_json: document, lesson_hash: lessonHash, model_id: input.modelId,
        prompt_version: input.promptVersion, authored_by: input.authoredBy,
        change_reason: input.changeReason?.trim() || null, created_at: new Date().toISOString() };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },

  async review(businessId: string, threadId: number, input: {
    lessonVersionId: number; lessonHash: string; action: CampaignLessonReviewAction;
    actorId: number; note?: string | null;
  }): Promise<number> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT lesson.id, lesson.lesson_hash, review.action
         FROM foresight_campaign_lesson_versions lesson
         LEFT JOIN foresight_campaign_lesson_review_events review
           ON review.business_id = lesson.business_id AND review.lesson_version_id = lesson.id
          AND review.id = (SELECT MAX(r.id) FROM foresight_campaign_lesson_review_events r
                           WHERE r.business_id = lesson.business_id AND r.lesson_version_id = lesson.id)
         WHERE lesson.business_id = ? AND lesson.thread_id = ? ORDER BY lesson.version DESC LIMIT 1 FOR UPDATE`,
        [businessId, threadId],
      );
      const lesson = (rows as Array<{ id: number; lesson_hash: string; action: string | null }>)[0];
      if (!lesson || lesson.id !== input.lessonVersionId || lesson.lesson_hash !== input.lessonHash) {
        throw new CampaignLessonTransitionError('Only the exact latest campaign lesson can be reviewed.');
      }
      if (lesson.action) throw new CampaignLessonTransitionError('This campaign lesson already has a decision.');
      const note = input.note?.trim() || null;
      if (input.action !== 'accepted' && !note) throw new CampaignLessonTransitionError('A note is required for rejection or revision requests.');
      const [result] = await connection.execute(
        `INSERT INTO foresight_campaign_lesson_review_events
           (business_id, thread_id, lesson_version_id, lesson_hash, action, actor_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [businessId, threadId, input.lessonVersionId, input.lessonHash, input.action, input.actorId, note],
      );
      await connection.commit();
      return (result as { insertId: number }).insertId;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },
};