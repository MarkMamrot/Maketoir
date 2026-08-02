import { getPool } from '@/services/MySQLService';
import type { CreativeIdentityObservation } from '../creative/creativeObservations';

export const ForesightCreativeRepository = {
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
