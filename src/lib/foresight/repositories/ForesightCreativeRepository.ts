import { getPool } from '@/services/MySQLService';
import type { CreativeIdentityObservation } from '../creative/creativeObservations';
import type { CreativeAssessmentDocument } from '../creative/creativeAssessment';
import type { CreativeDiagnosticInput } from '../creative/creativeDiagnostics';

export interface ForesightCreativeRow {
  id: number;
  business_id: string;
  source: 'google_ads' | 'meta_ads';
  account_id: string;
  external_id: string;
  creative_kind: 'ad' | 'asset' | 'creative';
  name: string;
  format: string | null;
  status: string | null;
  copy_json: Record<string, unknown> | null;
  media_json: Record<string, unknown> | null;
  first_seen_on: string;
  last_seen_on: string;
}

export interface ForesightCreativeAssessmentRow {
  id: number;
  business_id: string;
  creative_id: number;
  assessment_hash: string;
  creative_snapshot_hash: string;
  brand_profile_hash: string;
  evidence_mode: 'text_only' | 'image' | 'video_frame';
  model_id: string;
  prompt_version: string;
  prompt_hash: string;
  assessment_json: CreativeAssessmentDocument;
  assessed_by: number;
  created_at: string;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

export const ForesightCreativeRepository = {
  async list(businessId: string, limit = 100): Promise<ForesightCreativeRow[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const [rows] = await getPool().query(
      `SELECT id, business_id, source, account_id, external_id, creative_kind, name, format,
              status, copy_json, media_json, first_seen_on, last_seen_on
       FROM foresight_creatives WHERE business_id = ?
       ORDER BY last_seen_on DESC, id DESC LIMIT ${safeLimit}`,
      [businessId],
    );
    return (rows as ForesightCreativeRow[]).map((row) => ({
      ...row, copy_json: jsonObject(row.copy_json), media_json: jsonObject(row.media_json),
    }));
  },

  async get(businessId: string, creativeId: number): Promise<ForesightCreativeRow | null> {
    const [rows] = await getPool().query(
      `SELECT id, business_id, source, account_id, external_id, creative_kind, name, format,
              status, copy_json, media_json, first_seen_on, last_seen_on
       FROM foresight_creatives WHERE business_id = ? AND id = ? LIMIT 1`,
      [businessId, creativeId],
    );
    const row = (rows as ForesightCreativeRow[])[0];
    return row ? { ...row, copy_json: jsonObject(row.copy_json), media_json: jsonObject(row.media_json) } : null;
  },

  async latestAssessment(businessId: string, creativeId: number): Promise<ForesightCreativeAssessmentRow | null> {
    const [rows] = await getPool().query(
      `SELECT id, business_id, creative_id, assessment_hash, creative_snapshot_hash,
              brand_profile_hash, evidence_mode, model_id, prompt_version, prompt_hash,
              assessment_json, assessed_by, created_at
       FROM foresight_creative_assessments
       WHERE business_id = ? AND creative_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      [businessId, creativeId],
    );
    const row = (rows as ForesightCreativeAssessmentRow[])[0];
    return row ? { ...row, assessment_json: jsonObject(row.assessment_json) as unknown as CreativeAssessmentDocument } : null;
  },

  async saveAssessment(input: Omit<ForesightCreativeAssessmentRow, 'id' | 'created_at'>): Promise<ForesightCreativeAssessmentRow> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO foresight_creative_assessments
         (business_id, creative_id, assessment_hash, creative_snapshot_hash, brand_profile_hash,
          evidence_mode, model_id, prompt_version, prompt_hash, assessment_json, assessed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [input.business_id, input.creative_id, input.assessment_hash, input.creative_snapshot_hash,
        input.brand_profile_hash, input.evidence_mode, input.model_id, input.prompt_version,
        input.prompt_hash, JSON.stringify(input.assessment_json), input.assessed_by],
    );
    const [rows] = await pool.query(
      `SELECT id, business_id, creative_id, assessment_hash, creative_snapshot_hash,
              brand_profile_hash, evidence_mode, model_id, prompt_version, prompt_hash,
              assessment_json, assessed_by, created_at
       FROM foresight_creative_assessments
       WHERE business_id = ? AND creative_id = ? AND assessment_hash = ? LIMIT 1`,
      [input.business_id, input.creative_id, input.assessment_hash],
    );
    const row = (rows as ForesightCreativeAssessmentRow[])[0];
    if (!row) throw new Error('Creative assessment was not readable after persistence.');
    return { ...row, assessment_json: jsonObject(row.assessment_json) as unknown as CreativeAssessmentDocument };
  },

  async listDiagnosticInputs(
    businessId: string,
    startDate: string,
    endDate: string,
    limit = 100,
  ): Promise<CreativeDiagnosticInput[]> {
    const safeLimit = Math.max(2, Math.min(200, Math.trunc(limit)));
    const pool = getPool();
    const [metricResult, assessmentResult] = await Promise.all([
      pool.query(
        `SELECT creative.id AS creative_id, creative.source, creative.name, creative.format,
                metric.metric_date, metric.impressions, metric.clicks, metric.spend,
                metric.conversions, metric.attributed_revenue, metric.frequency
         FROM foresight_creatives creative
         INNER JOIN foresight_creative_daily_metrics metric
           ON metric.business_id = creative.business_id AND metric.creative_id = creative.id
         INNER JOIN (
           SELECT creative_id, metric_date, MAX(run_id) AS run_id
           FROM foresight_creative_daily_metrics
           WHERE business_id = ? AND metric_date BETWEEN ? AND ?
           GROUP BY creative_id, metric_date
         ) latest
           ON latest.creative_id = metric.creative_id
          AND latest.metric_date = metric.metric_date
          AND latest.run_id = metric.run_id
         WHERE creative.business_id = ?
           AND creative.id IN (
             SELECT recent.creative_id FROM (
               SELECT creative_id, SUM(impressions) AS exposure
               FROM foresight_creative_daily_metrics
               WHERE business_id = ? AND metric_date BETWEEN ? AND ?
               GROUP BY creative_id ORDER BY exposure DESC, creative_id LIMIT ${safeLimit}
             ) recent
           )
         ORDER BY creative.id, metric.metric_date`,
        [businessId, startDate, endDate, businessId, businessId, startDate, endDate],
      ),
      pool.query(
        `SELECT assessment.creative_id, assessment.assessment_json
         FROM foresight_creative_assessments assessment
         INNER JOIN (
           SELECT creative_id, MAX(id) AS id
           FROM foresight_creative_assessments
           WHERE business_id = ? GROUP BY creative_id
         ) latest ON latest.id = assessment.id
         WHERE assessment.business_id = ?`,
        [businessId, businessId],
      ),
    ]);
    const assessmentByCreative = new Map((assessmentResult[0] as Array<{ creative_id: number; assessment_json: unknown }>).map((row) => {
      const assessment = jsonObject(row.assessment_json) as unknown as CreativeAssessmentDocument | null;
      return [Number(row.creative_id), assessment] as const;
    }));
    type MetricRow = {
      creative_id: number; source: CreativeDiagnosticInput['source']; name: string; format: string | null;
      metric_date: unknown; impressions: number | string; clicks: number | string; spend: number | string;
      conversions: number | string; attributed_revenue: number | string; frequency: number | string | null;
    };
    const grouped = new Map<number, CreativeDiagnosticInput>();
    for (const row of metricResult[0] as MetricRow[]) {
      const creativeId = Number(row.creative_id);
      const assessment = assessmentByCreative.get(creativeId);
      const creative = grouped.get(creativeId) ?? {
        creativeId, source: row.source, name: row.name, format: row.format,
        tags: assessment?.structuredTags ?? [], brandFitObservations: assessment?.brandFitObservations ?? [],
        assessmentUncertainties: assessment?.uncertainties ?? [], metrics: [],
      };
      creative.metrics.push({
        metricDate: dateOnly(row.metric_date), impressions: Number(row.impressions), clicks: Number(row.clicks),
        spend: Number(row.spend), conversions: Number(row.conversions), attributedRevenue: Number(row.attributed_revenue),
        frequency: row.frequency == null ? null : Number(row.frequency),
      });
      grouped.set(creativeId, creative);
    }
    return [...grouped.values()];
  },

  async ingest(
    runId: number,
    businessId: string,
    observations: CreativeIdentityObservation[],
  ): Promise<number> {
    if (observations.length === 0) return 0;
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      for (const observation of observations) {
        const [result] = await connection.query(
          `INSERT INTO foresight_creatives
             (business_id, source, account_id, external_id, creative_kind, name, format,
              status, copy_json, media_json, first_seen_on, last_seen_on)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             id = LAST_INSERT_ID(id), creative_kind = VALUES(creative_kind), name = VALUES(name),
             format = VALUES(format), status = VALUES(status), copy_json = VALUES(copy_json),
             media_json = VALUES(media_json), first_seen_on = LEAST(first_seen_on, VALUES(first_seen_on)),
             last_seen_on = GREATEST(last_seen_on, VALUES(last_seen_on)), ended_on = NULL`,
          [businessId, observation.source, observation.accountId, observation.externalId,
            observation.creativeKind, observation.name, observation.format, observation.status,
            observation.copy ? JSON.stringify(observation.copy) : null,
            observation.media ? JSON.stringify(observation.media) : null,
            observation.firstSeenOn, observation.lastSeenOn],
        );
        const creativeId = Number((result as { insertId?: number }).insertId);
        if (!Number.isSafeInteger(creativeId) || creativeId <= 0) {
          throw new Error(`Could not resolve creative ${observation.source}:${observation.externalId}.`);
        }
        for (const link of observation.links) {
          await connection.query(
            `INSERT INTO foresight_creative_entity_links
               (business_id, creative_id, source, account_id, entity_type, entity_id,
                entity_name, first_seen_on, last_seen_on)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               entity_name = VALUES(entity_name), first_seen_on = LEAST(first_seen_on, VALUES(first_seen_on)),
               last_seen_on = GREATEST(last_seen_on, VALUES(last_seen_on))`,
            [businessId, creativeId, observation.source, observation.accountId, link.entityType,
              link.entityId, link.entityName, observation.firstSeenOn, observation.lastSeenOn],
          );
        }
        for (const metric of observation.metrics) {
          await connection.query(
            `INSERT INTO foresight_creative_daily_metrics
               (run_id, business_id, creative_id, source, account_id, metric_date, impressions,
                spend, clicks, conversions, attributed_revenue, reach, frequency, video_views, currency_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               impressions = VALUES(impressions), spend = VALUES(spend), clicks = VALUES(clicks),
               conversions = VALUES(conversions), attributed_revenue = VALUES(attributed_revenue),
               reach = VALUES(reach), frequency = VALUES(frequency), video_views = VALUES(video_views),
               currency_code = VALUES(currency_code)`,
            [runId, businessId, creativeId, observation.source, observation.accountId, metric.metricDate,
              metric.impressions, metric.spend, metric.clicks, metric.conversions, metric.attributedRevenue,
              metric.reach, metric.frequency, metric.videoViews, metric.currencyCode],
          );
        }
      }
      await connection.query(
        `DELETE FROM foresight_creative_daily_metrics
         WHERE business_id = ? AND metric_date < DATE_SUB(CURRENT_DATE, INTERVAL 24 MONTH)`,
        [businessId],
      );
      await connection.commit();
      return observations.length;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};
