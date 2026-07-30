import type {
  MetaAdAccountSetting,
  MetaAdSetSetting,
  MetaCampaignSetting,
} from '@/lib/foresight/metaExecutionPreflight';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const metaSdk = require('facebook-nodejs-business-sdk') as MetaSdk;

interface MetaReadable {
  read(fields: string[]): Promise<unknown>;
  update(fields: string[], params: Record<string, unknown>): Promise<unknown>;
}

interface MetaSdk {
  FacebookAdsApi: new (accessToken: string) => unknown;
  AdAccount: new (id: string, data?: object, parentId?: string, api?: unknown) => MetaReadable;
  Campaign: new (id: string, data?: object, parentId?: string, api?: unknown) => MetaReadable;
  AdSet: new (id: string, data?: object, parentId?: string, api?: unknown) => MetaReadable;
}

export interface MetaBudgetSettings {
  account: MetaAdAccountSetting;
  campaigns: MetaCampaignSetting[];
  adSets: MetaAdSetSetting[];
}

export interface MetaDailyBudgetUpdate {
  entityType: 'campaign' | 'adset';
  entityId: string;
  dailyBudgetMinor: number;
}

function plainData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown> & { exportData?: () => Record<string, unknown> };
  if (typeof record.exportData === 'function') return record.exportData();
  if (record._data && typeof record._data === 'object') return record._data as Record<string, unknown>;
  return record;
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function integer(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function accountNodeId(accountId: string): string {
  const normalized = accountId.trim().replace(/^act_/i, '');
  if (!/^\d+$/.test(normalized)) throw new Error('Meta ad account ID must contain digits only.');
  return `act_${normalized}`;
}

export class MetaAdsReadService {
  private readonly api: unknown;
  private readonly accountId: string;

  constructor(accessToken: string, accountId: string, private readonly sdk: MetaSdk = metaSdk) {
    if (!accessToken.trim()) throw new Error('Meta access token is required.');
    this.accountId = accountNodeId(accountId);
    this.api = new sdk.FacebookAdsApi(accessToken);
  }

  async getBudgetSettings(input: { campaignIds: string[]; adSetIds: string[] }): Promise<MetaBudgetSettings> {
    const accountRecord = await this.read(new this.sdk.AdAccount(this.accountId, {}, undefined, this.api), [
      'id', 'account_id', 'account_status', 'currency',
    ]);
    const adSetIds = [...new Set(input.adSetIds.map(text).filter(Boolean))];
    const adSets = await Promise.all(adSetIds.map((id) => this.readAdSet(id)));
    const campaignIds = [...new Set([
      ...input.campaignIds.map(text).filter(Boolean),
      ...adSets.map((adSet) => adSet.campaignId).filter(Boolean),
    ])];
    const campaigns = await Promise.all(campaignIds.map((id) => this.readCampaign(id)));

    return {
      account: {
        accountId: text(accountRecord.account_id) || text(accountRecord.id),
        accountStatus: integer(accountRecord.account_status) ?? 0,
        currencyCode: text(accountRecord.currency).toUpperCase(),
      },
      campaigns,
      adSets,
    };
  }

  async updateDailyBudgets(changes: MetaDailyBudgetUpdate[]): Promise<unknown[]> {
    if (changes.length === 0) throw new Error('At least one Meta daily-budget change is required.');
    return Promise.all(changes.map(change => {
      if (!change.entityId.trim()) throw new Error('Meta budget entity ID is required.');
      if (!Number.isSafeInteger(change.dailyBudgetMinor) || change.dailyBudgetMinor <= 0) {
        throw new Error('Meta daily budget must be a positive integer in account minor units.');
      }
      const entity = change.entityType === 'campaign'
        ? new this.sdk.Campaign(change.entityId, {}, undefined, this.api)
        : new this.sdk.AdSet(change.entityId, {}, undefined, this.api);
      return entity.update([], { daily_budget: change.dailyBudgetMinor });
    }));
  }

  private async readCampaign(id: string): Promise<MetaCampaignSetting> {
    const record = await this.read(new this.sdk.Campaign(id, {}, undefined, this.api), [
      'id', 'account_id', 'name', 'configured_status', 'effective_status', 'daily_budget', 'lifetime_budget',
    ]);
    return {
      accountId: text(record.account_id),
      campaignId: text(record.id) || id,
      campaignName: text(record.name) || id,
      configuredStatus: text(record.configured_status),
      effectiveStatus: text(record.effective_status),
      dailyBudgetMinor: integer(record.daily_budget),
      lifetimeBudgetMinor: integer(record.lifetime_budget),
    };
  }

  private async readAdSet(id: string): Promise<MetaAdSetSetting> {
    const record = await this.read(new this.sdk.AdSet(id, {}, undefined, this.api), [
      'id', 'account_id', 'campaign_id', 'name', 'configured_status', 'effective_status', 'daily_budget', 'lifetime_budget',
    ]);
    return {
      accountId: text(record.account_id),
      adSetId: text(record.id) || id,
      adSetName: text(record.name) || id,
      campaignId: text(record.campaign_id),
      configuredStatus: text(record.configured_status),
      effectiveStatus: text(record.effective_status),
      dailyBudgetMinor: integer(record.daily_budget),
      lifetimeBudgetMinor: integer(record.lifetime_budget),
    };
  }

  private async read(entity: MetaReadable, fields: string[]): Promise<Record<string, unknown>> {
    return plainData(await entity.read(fields));
  }
}