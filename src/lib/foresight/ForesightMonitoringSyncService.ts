import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { GoogleAdsService } from '@/services/GoogleAdsService';
import {
  aggregateGoogleAdsDaily,
  aggregateGoogleAdsEntities,
  aggregateMetaAdsDaily,
  aggregateMetaAdsEntities,
} from './metrics/marketingObservations';
import { ForesightIngestionRepository } from './repositories/ForesightIngestionRepository';
import { ForesightRepository } from './repositories/ForesightRepository';
import { ImsCommerceRepository } from './repositories/ImsCommerceRepository';

type SourceResult = { source: 'google_ads' | 'meta_ads' | 'commerce'; state: 'succeeded' | 'failed'; rows: number; error?: string };

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function fetchMetaDaily(accountId: string, accessToken: string, startDate: string, endDate: string, level: 'campaign' | 'adset') {
  const id = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const url = new URL(`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v25.0'}/${id}/insights`);
  url.searchParams.set('level', level);
  url.searchParams.set('fields', level === 'campaign'
    ? 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,account_currency,date_start,date_stop'
    : 'campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks,actions,action_values,account_currency,date_start,date_stop');
  url.searchParams.set('time_range', JSON.stringify({ since: startDate, until: endDate }));
  url.searchParams.set('time_increment', '1');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);
  const rows: unknown[] = [];
  let next: string | null = url.toString();
  while (next) {
    const response: Response = await fetch(next);
    const body = await response.json() as { data?: unknown[]; paging?: { next?: string }; error?: { message?: string } };
    if (!response.ok || body.error) throw new Error(body.error?.message || `Meta insights failed with HTTP ${response.status}.`);
    rows.push(...(body.data ?? []));
    next = body.paging?.next ?? null;
  }
  return rows;
}

export const ForesightMonitoringSyncService = {
  async syncActiveWindow(businessId: string, throughDate: string) {
    if (!await ForesightRepository.hasActiveOutcomeMonitoring(businessId, 7)) {
      return { skipped: true, reason: 'no_active_monitoring', throughDate, runId: null, sources: [] as SourceResult[] };
    }

    const startDate = addDays(throughDate, -13);
    const connection = await ConnectionsRepository.get(businessId);
    const requestedSources: Array<'google_ads' | 'meta_ads' | 'commerce'> = ['commerce'];
    if (connection?.google_ads_customer_id && connection.google_ads_refresh_token) requestedSources.unshift('google_ads');
    if (connection?.meta_ad_account_id && connection.meta_access_token) requestedSources.splice(requestedSources.length - 1, 0, 'meta_ads');
    const runId = await ForesightIngestionRepository.startSyncRun(businessId, requestedSources, startDate, throughDate, null);
    const results: SourceResult[] = [];

    const record = async (result: SourceResult, accountId: string, tabKey: string, label: string) => {
      results.push(result);
      await ForesightIngestionRepository.recordSyncTab(runId, businessId, {
        source: result.source, accountId, tabKey, label, state: result.state,
        windowStart: startDate, windowEnd: throughDate, rowCount: result.rows, error: result.error,
        metadata: { purpose: 'post_execution_monitoring' },
      });
    };

    if (requestedSources.includes('google_ads')) {
      const accountId = connection!.google_ads_customer_id!.replace(/-/g, '');
      try {
        const service = new GoogleAdsService(accountId, decrypt(connection!.google_ads_refresh_token!));
        const raw = await service.getDailyPerformance(startDate, throughDate);
        const rows = Array.isArray(raw) ? raw : [];
        const daily = aggregateGoogleAdsDaily(rows, accountId);
        const entities = aggregateGoogleAdsEntities(rows, accountId);
        await ForesightIngestionRepository.appendPaidMediaObservations(runId, businessId, daily);
        await ForesightIngestionRepository.appendPaidMediaEntityObservations(runId, businessId, entities);
        await record({ source: 'google_ads', state: 'succeeded', rows: daily.length }, accountId, 'GAds_DailyPerformance', 'Daily Performance');
      } catch (error) {
        await record({ source: 'google_ads', state: 'failed', rows: 0, error: error instanceof Error ? error.message : 'Google Ads monitoring sync failed.' }, accountId, 'GAds_DailyPerformance', 'Daily Performance');
      }
    }

    if (requestedSources.includes('meta_ads')) {
      const accountId = connection!.meta_ad_account_id!;
      try {
        const accessToken = decrypt(connection!.meta_access_token!);
        const [campaignRows, adSetRows] = await Promise.all([
          fetchMetaDaily(accountId, accessToken, startDate, throughDate, 'campaign'),
          fetchMetaDaily(accountId, accessToken, startDate, throughDate, 'adset'),
        ]);
        const daily = aggregateMetaAdsDaily(campaignRows, accountId);
        const entities = [
          ...aggregateMetaAdsEntities(campaignRows, accountId, 'campaign'),
          ...aggregateMetaAdsEntities(adSetRows, accountId, 'adset'),
        ];
        await ForesightIngestionRepository.appendPaidMediaObservations(runId, businessId, daily);
        await ForesightIngestionRepository.appendPaidMediaEntityObservations(runId, businessId, entities);
        await record({ source: 'meta_ads', state: 'succeeded', rows: daily.length }, accountId, 'Meta_DailyPerformance', 'Daily Performance');
      } catch (error) {
        await record({ source: 'meta_ads', state: 'failed', rows: 0, error: error instanceof Error ? error.message : 'Meta monitoring sync failed.' }, accountId, 'Meta_DailyPerformance', 'Daily Performance');
      }
    }

    try {
      const commerce = await ImsCommerceRepository.getDailyCommerce(businessId, startDate, throughDate);
      await ForesightIngestionRepository.appendCommerceObservations(runId, businessId, commerce);
      await record({ source: 'commerce', state: 'succeeded', rows: commerce.length }, 'ims', 'Commerce_Daily', 'Retail Commerce');
    } catch (error) {
      await record({ source: 'commerce', state: 'failed', rows: 0, error: error instanceof Error ? error.message : 'Commerce monitoring sync failed.' }, 'ims', 'Commerce_Daily', 'Retail Commerce');
    }

    const successful = results.filter(item => item.state === 'succeeded').length;
    const failed = results.length - successful;
    const state = failed === 0 ? 'succeeded' : successful > 0 ? 'partial' : 'failed';
    await ForesightIngestionRepository.completeSyncRun(runId, businessId, state, successful, failed,
      failed > 0 ? results.filter(item => item.error).map(item => `${item.source}: ${item.error}`).join(' ') : null);
    return { skipped: false, throughDate, runId, state, sources: results };
  },
};