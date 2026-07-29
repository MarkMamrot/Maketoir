export type PaidMediaSource = 'google_ads' | 'meta_ads';
export type PaidMediaEntityType = 'campaign' | 'adset';

export interface DailyPaidMediaObservation {
  metricDate: string;
  source: PaidMediaSource;
  accountId: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  attributedRevenue: number;
  currencyCode: string | null;
}

interface MutableObservation extends DailyPaidMediaObservation {}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(value: unknown): string | null {
  const key = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

function observation(
  source: PaidMediaSource,
  accountId: string,
  metricDate: string,
  currencyCode: string | null,
): MutableObservation {
  return {
    metricDate,
    source,
    accountId,
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    attributedRevenue: 0,
    currencyCode,
  };
}

function sorted(observations: Map<string, MutableObservation>): DailyPaidMediaObservation[] {
  return [...observations.values()].sort((left, right) => left.metricDate.localeCompare(right.metricDate));
}

export function aggregateGoogleAdsDaily(
  rows: unknown[],
  accountId: string,
): DailyPaidMediaObservation[] {
  const observations = new Map<string, MutableObservation>();

  for (const row of rows) {
    const record = asRecord(row);
    const segments = asRecord(record.segments);
    const metrics = asRecord(record.metrics);
    const customer = asRecord(record.customer);
    const metricDate = dateKey(segments.date);
    if (!metricDate) continue;

    const currencyCode = String(customer.currency_code ?? '').trim() || null;
    const current = observations.get(metricDate)
      ?? observation('google_ads', accountId, metricDate, currencyCode);
    current.spend += asNumber(metrics.cost_micros) / 1_000_000;
    current.impressions += asNumber(metrics.impressions);
    current.clicks += asNumber(metrics.clicks);
    current.conversions += asNumber(metrics.conversions);
    current.attributedRevenue += asNumber(metrics.conversions_value);
    current.currencyCode ??= currencyCode;
    observations.set(metricDate, current);
  }

  return sorted(observations);
}

const META_PURCHASE_ACTIONS = [
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'purchase',
] as const;

function metaActionValue(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  const actions = value.map(asRecord);
  for (const actionType of META_PURCHASE_ACTIONS) {
    const match = actions.find((action) => action.action_type === actionType);
    if (match) return asNumber(match.value);
  }
  return 0;
}

export function aggregateMetaAdsDaily(
  rows: unknown[],
  accountId: string,
  currencyCode: string | null = null,
): DailyPaidMediaObservation[] {
  const observations = new Map<string, MutableObservation>();

  for (const row of rows) {
    const record = asRecord(row);
    const metricDate = dateKey(record.date_start);
    if (!metricDate) continue;

    const current = observations.get(metricDate)
      ?? observation('meta_ads', accountId, metricDate, currencyCode);
    current.spend += asNumber(record.spend);
    current.impressions += asNumber(record.impressions);
    current.clicks += asNumber(record.clicks);
    current.conversions += metaActionValue(record.actions);
    current.attributedRevenue += metaActionValue(record.action_values);
    observations.set(metricDate, current);
  }

  return sorted(observations);
}

export interface DailyPaidMediaEntityObservation extends DailyPaidMediaObservation {
  entityType: PaidMediaEntityType;
  entityId: string;
  entityName: string;
  parentEntityId: string | null;
  parentEntityName: string | null;
}

function entityObservation(
  source: PaidMediaSource,
  accountId: string,
  metricDate: string,
  currencyCode: string | null,
  entityType: PaidMediaEntityType,
  entityId: string,
  entityName: string,
  parentEntityId: string | null = null,
  parentEntityName: string | null = null,
): DailyPaidMediaEntityObservation {
  return {
    ...observation(source, accountId, metricDate, currencyCode),
    entityType,
    entityId,
    entityName,
    parentEntityId,
    parentEntityName,
  };
}

function sortedEntities(
  observations: Map<string, DailyPaidMediaEntityObservation>,
): DailyPaidMediaEntityObservation[] {
  return [...observations.values()].sort((left, right) =>
    left.metricDate.localeCompare(right.metricDate)
    || left.source.localeCompare(right.source)
    || left.entityType.localeCompare(right.entityType)
    || left.entityName.localeCompare(right.entityName));
}

export function aggregateGoogleAdsEntities(
  rows: unknown[],
  accountId: string,
): DailyPaidMediaEntityObservation[] {
  const observations = new Map<string, DailyPaidMediaEntityObservation>();

  for (const row of rows) {
    const record = asRecord(row);
    const campaign = asRecord(record.campaign);
    const segments = asRecord(record.segments);
    const metrics = asRecord(record.metrics);
    const customer = asRecord(record.customer);
    const metricDate = dateKey(segments.date);
    const entityId = String(campaign.id ?? '').trim();
    if (!metricDate || !entityId) continue;

    const key = `${metricDate}:campaign:${entityId}`;
    const currencyCode = String(customer.currency_code ?? '').trim() || null;
    const current = observations.get(key) ?? entityObservation(
      'google_ads',
      accountId,
      metricDate,
      currencyCode,
      'campaign',
      entityId,
      String(campaign.name ?? entityId),
    );
    current.spend += asNumber(metrics.cost_micros) / 1_000_000;
    current.impressions += asNumber(metrics.impressions);
    current.clicks += asNumber(metrics.clicks);
    current.conversions += asNumber(metrics.conversions);
    current.attributedRevenue += asNumber(metrics.conversions_value);
    observations.set(key, current);
  }

  return sortedEntities(observations);
}

export function aggregateMetaAdsEntities(
  rows: unknown[],
  accountId: string,
  entityType: PaidMediaEntityType,
  currencyCode: string | null = null,
): DailyPaidMediaEntityObservation[] {
  const observations = new Map<string, DailyPaidMediaEntityObservation>();

  for (const row of rows) {
    const record = asRecord(row);
    const metricDate = dateKey(record.date_start);
    const idKey = entityType === 'campaign' ? 'campaign_id' : 'adset_id';
    const nameKey = entityType === 'campaign' ? 'campaign_name' : 'adset_name';
    const entityId = String(record[idKey] ?? '').trim();
    if (!metricDate || !entityId) continue;

    const key = `${metricDate}:${entityType}:${entityId}`;
    const current = observations.get(key) ?? entityObservation(
      'meta_ads',
      accountId,
      metricDate,
      currencyCode,
      entityType,
      entityId,
      String(record[nameKey] ?? entityId),
      entityType === 'adset' ? String(record.campaign_id ?? '').trim() || null : null,
      entityType === 'adset' ? String(record.campaign_name ?? '').trim() || null : null,
    );
    current.spend += asNumber(record.spend);
    current.impressions += asNumber(record.impressions);
    current.clicks += asNumber(record.clicks);
    current.conversions += metaActionValue(record.actions);
    current.attributedRevenue += metaActionValue(record.action_values);
    observations.set(key, current);
  }

  return sortedEntities(observations);
}