import { getPool, query } from '@/services/MySQLService';
import { hashForesightCampaignExperiment, parseForesightCampaignExperimentDocument, type ForesightCampaignExperimentDocument } from '../planning/campaignExperimentDocument';

export type CampaignExperimentReviewAction = 'accepted' | 'rejected' | 'revision_requested';
export interface CampaignExperimentVersionRow {
  id: number; business_id: string; thread_id: number; lesson_version_id: number; lesson_hash: string;
  version: number; parent_id: number | null; schema_version: number; experiment_json: ForesightCampaignExperimentDocument;
  experiment_hash: string; model_id: string | null; prompt_version: string | null; authored_by: number;
  change_reason: string | null; created_at: string;
}
export interface CampaignExperimentReviewRow {
  id: number; business_id: string; thread_id: number; experiment_version_id: number; experiment_hash: string;
  action: CampaignExperimentReviewAction; actor_id: number; note: string | null; created_at: string;
}
export class CampaignExperimentTransitionError extends Error {
  constructor(message: string) { super(message); this.name = 'CampaignExperimentTransitionError'; }
}
function json<T>(value: T | string): T { return typeof value === 'string' ? JSON.parse(value) as T : value; }

export const ForesightCampaignExperimentRepository = {
  async latest(businessId: string, threadId: number): Promise<CampaignExperimentVersionRow | null> {
    const rows = await query<CampaignExperimentVersionRow>(`SELECT * FROM foresight_campaign_experiment_versions WHERE business_id = ? AND thread_id = ? ORDER BY version DESC LIMIT 1`, [businessId, threadId]);
    return rows[0] ? { ...rows[0], experiment_json: json(rows[0].experiment_json) } : null;
  },
  async latestReview(businessId: string, threadId: number): Promise<CampaignExperimentReviewRow | null> {
    const rows = await query<CampaignExperimentReviewRow>(
      `SELECT review.* FROM foresight_campaign_experiment_review_events review
       INNER JOIN foresight_campaign_experiment_versions experiment ON experiment.business_id = review.business_id AND experiment.id = review.experiment_version_id
       WHERE review.business_id = ? AND review.thread_id = ? ORDER BY experiment.version DESC, review.id DESC LIMIT 1`, [businessId, threadId]);
    return rows[0] ?? null;
  },
  async createVersion(businessId: string, threadId: number, input: {
    lessonVersionId: number; lessonHash: string; lessonVersion: number; document: unknown; modelId: string;
    promptVersion: string; authoredBy: number; changeReason?: string | null;
  }): Promise<CampaignExperimentVersionRow> {
    const lessonFactId = `foresight:campaign-lesson:${input.lessonVersionId}:v${input.lessonVersion}`;
    const document = parseForesightCampaignExperimentDocument(input.document, { lessonVersionId: input.lessonVersionId, lessonHash: input.lessonHash, lessonFactId });
    const experimentHash = hashForesightCampaignExperiment(document);
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [lessonRows] = await connection.execute(
        `SELECT lesson.id, lesson.lesson_hash, lesson.version, review.action
         FROM foresight_campaign_lesson_versions lesson
         INNER JOIN foresight_campaign_lesson_review_events review
           ON review.business_id = lesson.business_id AND review.lesson_version_id = lesson.id AND review.lesson_hash = lesson.lesson_hash
         WHERE lesson.business_id = ? AND lesson.thread_id = ? ORDER BY lesson.version DESC, review.id DESC LIMIT 1 FOR UPDATE`,
        [businessId, threadId]);
      const lesson = (lessonRows as Array<{ id: number; lesson_hash: string; version: number; action: string }>)[0];
      if (!lesson || lesson.id !== input.lessonVersionId || lesson.lesson_hash !== input.lessonHash || lesson.version !== input.lessonVersion || lesson.action !== 'accepted') {
        throw new CampaignExperimentTransitionError('An exact human-accepted latest campaign lesson is required.');
      }
      const [latestRows] = await connection.execute(
        `SELECT experiment.id, experiment.version, review.action FROM foresight_campaign_experiment_versions experiment
         LEFT JOIN foresight_campaign_experiment_review_events review ON review.business_id = experiment.business_id AND review.experiment_version_id = experiment.id
          AND review.id = (SELECT MAX(r.id) FROM foresight_campaign_experiment_review_events r WHERE r.business_id = experiment.business_id AND r.experiment_version_id = experiment.id)
         WHERE experiment.business_id = ? AND experiment.lesson_version_id = ? ORDER BY experiment.version DESC LIMIT 1 FOR UPDATE`,
        [businessId, input.lessonVersionId]);
      const latest = (latestRows as Array<{ id: number; version: number; action: string | null }>)[0];
      if (latest?.action === 'accepted') throw new CampaignExperimentTransitionError('An accepted campaign experiment cannot be superseded.');
      if (latest && latest.action !== 'rejected' && latest.action !== 'revision_requested') throw new CampaignExperimentTransitionError('Review the current campaign experiment before drafting another version.');
      const version = (latest?.version ?? 0) + 1;
      const [result] = await connection.execute(
        `INSERT INTO foresight_campaign_experiment_versions
          (business_id, thread_id, lesson_version_id, lesson_hash, version, parent_id, schema_version, experiment_json, experiment_hash, model_id, prompt_version, authored_by, change_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [businessId, threadId, input.lessonVersionId, input.lessonHash, version, latest?.id ?? null, 1, JSON.stringify(document), experimentHash, input.modelId, input.promptVersion, input.authoredBy, input.changeReason?.trim() || null]);
      await connection.commit();
      return { id: (result as { insertId: number }).insertId, business_id: businessId, thread_id: threadId,
        lesson_version_id: input.lessonVersionId, lesson_hash: input.lessonHash, version, parent_id: latest?.id ?? null,
        schema_version: 1, experiment_json: document, experiment_hash: experimentHash, model_id: input.modelId,
        prompt_version: input.promptVersion, authored_by: input.authoredBy, change_reason: input.changeReason?.trim() || null, created_at: new Date().toISOString() };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },
  async review(businessId: string, threadId: number, input: { experimentVersionId: number; experimentHash: string; action: CampaignExperimentReviewAction; actorId: number; note?: string | null }): Promise<number> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT experiment.id, experiment.experiment_hash, review.action FROM foresight_campaign_experiment_versions experiment
         LEFT JOIN foresight_campaign_experiment_review_events review ON review.business_id = experiment.business_id AND review.experiment_version_id = experiment.id
          AND review.id = (SELECT MAX(r.id) FROM foresight_campaign_experiment_review_events r WHERE r.business_id = experiment.business_id AND r.experiment_version_id = experiment.id)
         WHERE experiment.business_id = ? AND experiment.thread_id = ? ORDER BY experiment.version DESC LIMIT 1 FOR UPDATE`, [businessId, threadId]);
      const experiment = (rows as Array<{ id: number; experiment_hash: string; action: string | null }>)[0];
      if (!experiment || experiment.id !== input.experimentVersionId || experiment.experiment_hash !== input.experimentHash) throw new CampaignExperimentTransitionError('Only the exact latest campaign experiment can be reviewed.');
      if (experiment.action) throw new CampaignExperimentTransitionError('This campaign experiment already has a decision.');
      const note = input.note?.trim() || null;
      if (input.action !== 'accepted' && !note) throw new CampaignExperimentTransitionError('A note is required for rejection or revision requests.');
      const [result] = await connection.execute(
        `INSERT INTO foresight_campaign_experiment_review_events (business_id, thread_id, experiment_version_id, experiment_hash, action, actor_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [businessId, threadId, input.experimentVersionId, input.experimentHash, input.action, input.actorId, note]);
      await connection.commit(); return (result as { insertId: number }).insertId;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },
};