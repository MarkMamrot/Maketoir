import { execute, getPool, query } from '@/services/MySQLService';
import type {
  DailyPaidMediaEntityObservation,
  DailyPaidMediaObservation,
  PaidMediaEntityType,
  PaidMediaSource,
} from '../metrics/marketingObservations';
import type { DailyCommerceObservation } from '../metrics/commerceReconciliation';

export type ForesightSyncSource = PaidMediaSource | 'ga4' | 'klaviyo' | 'commerce';
export type ForesightSyncRunState = 'succeeded' | 'partial' | 'failed';

export interface RecordSyncTabInput {
  source: ForesightSyncSource;
  accountId: string;
  tabKey: string;
  label: string;
  state: 'succeeded' | 'failed';
  windowStart?: string | null;
  windowEnd?: string | null;
  rowCount?: number;
  metadata?: Record<string, unknown> | null;
  error?: string | null;
}

export interface ForesightSyncRunRow {
  id: number;
  business_id: string;
  requested_sources: ForesightSyncSource[];
  state: 'running' | ForesightSyncRunState;
  window_start: string;
  window_end: string;
  successful_tabs: number;
  failed_tabs: number;
  error_text: string | null;
  started_at: string;
  completed_at: string | null;
}

interface PaidMediaObservationRow {
  metric_date: string;
  source: PaidMediaSource;
  account_id: string;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  conversions: number | string;
  attributed_revenue: number | string;
  currency_code: string | null;
}

interface PaidMediaEntityObservationRow extends PaidMediaObservationRow {
  entity_type: PaidMediaEntityType;
  entity_id: string;
  entity_name: string;
  parent_entity_id: string | null;
  parent_entity_name: string | null;
}

interface CommerceObservationRow {
  metric_date: string;
  channel: DailyCommerceObservation['channel'];
  sales_inc_tax: number | string;
  sales_tax: number | string;
  returns_inc_tax: number | string;
  returns_tax: number | string;
  sales_cogs: number | string;
  returned_cogs: number | string;
  order_count: number | string;
  return_count: number | string;
  cost_line_count: number | string;
  missing_cost_line_count: number | string;
  cost_basis: DailyCommerceObservation['costBasis'];
}

export const ForesightIngestionRepository = {
  async listRecentSyncRuns(businessId: string, limit = 20): Promise<ForesightSyncRunRow[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = await query<Omit<ForesightSyncRunRow, 'requested_sources'> & { requested_sources: string }>(
      `SELECT id, business_id, requested_sources, state, window_start, window_end,
              successful_tabs, failed_tabs, error_text, started_at, completed_at
       FROM foresight_sync_runs
       WHERE business_id = ?
       ORDER BY started_at DESC
       LIMIT ${safeLimit}`,
      [businessId],
    );
    return rows.map((row) => ({
      ...row,
      requested_sources: typeof row.requested_sources === 'string'
        ? JSON.parse(row.requested_sources) as ForesightSyncSource[]
        : row.requested_sources,
    }));
  },

  async getLatestPaidMediaTrend(
    businessId: string,
    startDate: string,
    endDate: string,
  ): Promise<DailyPaidMediaObservation[]> {
    const rows = await query<PaidMediaObservationRow>(
      `SELECT observation.metric_date, observation.source, observation.account_id,
              observation.spend, observation.impressions, observation.clicks,
              observation.conversions, observation.attributed_revenue, observation.currency_code
       FROM foresight_marketing_observations observation
       INNER JOIN (
         SELECT source, account_id, metric_date, MAX(run_id) AS run_id
         FROM foresight_marketing_observations
         WHERE business_id = ? AND metric_date BETWEEN ? AND ?
         GROUP BY source, account_id, metric_date
       ) latest
         ON latest.source = observation.source
        AND latest.account_id = observation.account_id
        AND latest.metric_date = observation.metric_date
        AND latest.run_id = observation.run_id
       WHERE observation.business_id = ?
       ORDER BY observation.metric_date, observation.source, observation.account_id`,
      [businessId, startDate, endDate, businessId],
    );
    return rows.map((row) => ({
      metricDate: String(row.metric_date).slice(0, 10),
      source: row.source,
      accountId: row.account_id,
      spend: Number(row.spend),
      impressions: Number(row.impressions),
      clicks: Number(row.clicks),
      conversions: Number(row.conversions),
      attributedRevenue: Number(row.attributed_revenue),
      currencyCode: row.currency_code,
    }));
  },

  async getLatestPaidMediaEntityTrend(
    businessId: string,
    startDate: string,
    endDate: string,
  ): Promise<DailyPaidMediaEntityObservation[]> {
    const rows = await query<PaidMediaEntityObservationRow>(
      `SELECT observation.metric_date, observation.source, observation.account_id,
              observation.entity_type, observation.entity_id, observation.entity_name,
              observation.parent_entity_id, observation.parent_entity_name,
              observation.spend, observation.impressions, observation.clicks,
              observation.conversions, observation.attributed_revenue, observation.currency_code
       FROM foresight_marketing_entity_observations observation
       INNER JOIN (
         SELECT source, account_id, entity_type, entity_id, metric_date, MAX(run_id) AS run_id
         FROM foresight_marketing_entity_observations
         WHERE business_id = ? AND metric_date BETWEEN ? AND ?
         GROUP BY source, account_id, entity_type, entity_id, metric_date
       ) latest
         ON latest.source = observation.source
        AND latest.account_id = observation.account_id
        AND latest.entity_type = observation.entity_type
        AND latest.entity_id = observation.entity_id
        AND latest.metric_date = observation.metric_date
        AND latest.run_id = observation.run_id
       WHERE observation.business_id = ?
       ORDER BY observation.metric_date, observation.source, observation.entity_type,
                observation.entity_name, observation.entity_id`,
      [businessId, startDate, endDate, businessId],
    );
    return rows.map((row) => ({
      metricDate: String(row.metric_date).slice(0, 10),
      source: row.source,
      accountId: row.account_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      entityName: row.entity_name,
      parentEntityId: row.parent_entity_id,
      parentEntityName: row.parent_entity_name,
      spend: Number(row.spend),
      impressions: Number(row.impressions),
      clicks: Number(row.clicks),
      conversions: Number(row.conversions),
      attributedRevenue: Number(row.attributed_revenue),
      currencyCode: row.currency_code,
    }));
  },

  async getLatestCommerceTrend(
    businessId: string,
    startDate: string,
    endDate: string,
  ): Promise<DailyCommerceObservation[]> {
    const rows = await query<CommerceObservationRow>(
      `SELECT observation.metric_date, observation.channel,
              observation.sales_inc_tax, observation.sales_tax,
              observation.returns_inc_tax, observation.returns_tax,
              observation.sales_cogs, observation.returned_cogs,
              observation.order_count, observation.return_count,
              observation.cost_line_count, observation.missing_cost_line_count,
              observation.cost_basis
       FROM foresight_commerce_observations observation
       INNER JOIN (
         SELECT channel, metric_date, MAX(run_id) AS run_id
         FROM foresight_commerce_observations
         WHERE business_id = ? AND metric_date BETWEEN ? AND ?
         GROUP BY channel, metric_date
       ) latest
         ON latest.channel = observation.channel
        AND latest.metric_date = observation.metric_date
        AND latest.run_id = observation.run_id
       WHERE observation.business_id = ?
       ORDER BY observation.metric_date, observation.channel`,
      [businessId, startDate, endDate, businessId],
    );
    return rows.map((row) => ({
      metricDate: String(row.metric_date).slice(0, 10),
      channel: row.channel,
      salesIncTax: Number(row.sales_inc_tax),
      salesTax: Number(row.sales_tax),
      returnsIncTax: Number(row.returns_inc_tax),
      returnsTax: Number(row.returns_tax),
      salesCogs: Number(row.sales_cogs),
      returnedCogs: Number(row.returned_cogs),
      orderCount: Number(row.order_count),
      returnCount: Number(row.return_count),
      costLineCount: Number(row.cost_line_count),
      missingCostLineCount: Number(row.missing_cost_line_count),
      costBasis: row.cost_basis,
    }));
  },

  async startSyncRun(
    businessId: string,
    requestedSources: ForesightSyncSource[],
    windowStart: string,
    windowEnd: string,
    startedBy?: number | null,
  ): Promise<number> {
    const result = await execute(
      `INSERT INTO foresight_sync_runs
         (business_id, requested_sources, state, window_start, window_end, started_by)
       VALUES (?, ?, 'running', ?, ?, ?)`,
      [businessId, JSON.stringify(requestedSources), windowStart, windowEnd, startedBy ?? null],
    );
    return result.insertId;
  },

  async recordSyncTab(
    runId: number,
    businessId: string,
    input: RecordSyncTabInput,
  ): Promise<void> {
    await execute(
      `INSERT INTO foresight_sync_tabs
         (run_id, business_id, source, account_id, tab_key, label, state,
          window_start, window_end, row_count, metadata_json, error_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         state = VALUES(state), row_count = VALUES(row_count),
         metadata_json = VALUES(metadata_json), error_text = VALUES(error_text),
         completed_at = CURRENT_TIMESTAMP`,
      [
        runId,
        businessId,
        input.source,
        input.accountId,
        input.tabKey,
        input.label,
        input.state,
        input.windowStart ?? null,
        input.windowEnd ?? null,
        input.rowCount ?? 0,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.error ?? null,
      ],
    );
  },

  async appendPaidMediaObservations(
    runId: number,
    businessId: string,
    observations: DailyPaidMediaObservation[],
  ): Promise<void> {
    if (observations.length === 0) return;
    const pool = getPool();
    const chunkSize = 200;

    for (let index = 0; index < observations.length; index += chunkSize) {
      const chunk = observations.slice(index, index + chunkSize);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
      const values = chunk.flatMap((item) => [
        runId,
        businessId,
        item.source,
        item.accountId,
        item.metricDate,
        item.spend,
        item.impressions,
        item.clicks,
        item.conversions,
        item.attributedRevenue,
        item.currencyCode,
      ]);
      await pool.query(
        `INSERT INTO foresight_marketing_observations
           (run_id, business_id, source, account_id, metric_date, spend,
            impressions, clicks, conversions, attributed_revenue, currency_code)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           spend = VALUES(spend), impressions = VALUES(impressions), clicks = VALUES(clicks),
           conversions = VALUES(conversions), attributed_revenue = VALUES(attributed_revenue),
           currency_code = VALUES(currency_code)`,
        values,
      );
    }
  },

  async appendPaidMediaEntityObservations(
    runId: number,
    businessId: string,
    observations: DailyPaidMediaEntityObservation[],
  ): Promise<void> {
    if (observations.length === 0) return;
    const pool = getPool();
    const chunkSize = 200;

    for (let index = 0; index < observations.length; index += chunkSize) {
      const chunk = observations.slice(index, index + chunkSize);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      const values = chunk.flatMap((item) => [
        runId,
        businessId,
        item.source,
        item.accountId,
        item.metricDate,
        item.entityType,
        item.entityId,
        item.entityName,
        item.parentEntityId,
        item.parentEntityName,
        item.spend,
        item.impressions,
        item.clicks,
        item.conversions,
        item.attributedRevenue,
        item.currencyCode,
      ]);
      await pool.query(
        `INSERT INTO foresight_marketing_entity_observations
           (run_id, business_id, source, account_id, metric_date, entity_type,
            entity_id, entity_name, parent_entity_id, parent_entity_name, spend,
            impressions, clicks, conversions, attributed_revenue, currency_code)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           entity_name = VALUES(entity_name), parent_entity_id = VALUES(parent_entity_id),
           parent_entity_name = VALUES(parent_entity_name), spend = VALUES(spend),
           impressions = VALUES(impressions), clicks = VALUES(clicks),
           conversions = VALUES(conversions), attributed_revenue = VALUES(attributed_revenue),
           currency_code = VALUES(currency_code)`,
        values,
      );
    }
  },

  async appendCommerceObservations(
    runId: number,
    businessId: string,
    observations: DailyCommerceObservation[],
  ): Promise<void> {
    if (observations.length === 0) return;
    const pool = getPool();
    const chunkSize = 200;

    for (let index = 0; index < observations.length; index += chunkSize) {
      const chunk = observations.slice(index, index + chunkSize);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      const values = chunk.flatMap((item) => [
        runId,
        businessId,
        item.metricDate,
        item.channel,
        item.salesIncTax,
        item.salesTax,
        item.returnsIncTax,
        item.returnsTax,
        item.salesCogs,
        item.returnedCogs,
        item.orderCount,
        item.returnCount,
        item.costLineCount,
        item.missingCostLineCount,
        item.costBasis,
      ]);
      await pool.query(
        `INSERT INTO foresight_commerce_observations
           (run_id, business_id, metric_date, channel, sales_inc_tax, sales_tax,
            returns_inc_tax, returns_tax, sales_cogs, returned_cogs, order_count,
            return_count, cost_line_count, missing_cost_line_count, cost_basis)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           sales_inc_tax = VALUES(sales_inc_tax), sales_tax = VALUES(sales_tax),
           returns_inc_tax = VALUES(returns_inc_tax), returns_tax = VALUES(returns_tax),
           sales_cogs = VALUES(sales_cogs), returned_cogs = VALUES(returned_cogs),
           order_count = VALUES(order_count), return_count = VALUES(return_count),
           cost_line_count = VALUES(cost_line_count),
           missing_cost_line_count = VALUES(missing_cost_line_count),
           cost_basis = VALUES(cost_basis)`,
        values,
      );
    }
  },

  async completeSyncRun(
    runId: number,
    businessId: string,
    state: ForesightSyncRunState,
    successfulTabs: number,
    failedTabs: number,
    error?: string | null,
  ): Promise<void> {
    await execute(
      `UPDATE foresight_sync_runs
       SET state = ?, successful_tabs = ?, failed_tabs = ?, error_text = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND business_id = ?`,
      [state, successfulTabs, failedTabs, error ?? null, runId, businessId],
    );
  },
};