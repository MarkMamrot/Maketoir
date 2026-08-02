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
  delete?(fields: string[], params?: Record<string, unknown>): Promise<unknown>;
  getCampaigns?(fields: string[], params: Record<string, unknown>): Promise<unknown>;
  getAds?(fields: string[], params: Record<string, unknown>): Promise<unknown>;
  getInsights?(fields: string[], params: Record<string, unknown>): Promise<unknown>;
  getCells?(fields: string[], params: Record<string, unknown>): Promise<unknown>;
  getAdStudies?(fields: string[], params: Record<string, unknown>): Promise<unknown>;
  createAdStudy?(fields: string[], params: Record<string, unknown>): Promise<unknown>;
}

interface MetaSdk {
  FacebookAdsApi: new (accessToken: string) => unknown;
  AdAccount: new (id: string, data?: object, parentId?: string, api?: unknown) => MetaReadable;
  Campaign: new (id: string, data?: object, parentId?: string, api?: unknown) => MetaReadable;
  AdSet: new (id: string, data?: object, parentId?: string, api?: unknown) => MetaReadable;
  Business: new (id: string, data?: object, parentId?: string, api?: unknown) => MetaReadable;
  AdStudy: new (id: string, data?: object, parentId?: string, api?: unknown) => MetaReadable;
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

export interface MetaCampaignOption {
  campaignId: string;
  campaignName: string;
  accountId: string;
  objective: string;
  configuredStatus: string;
  effectiveStatus: string;
}

export interface MetaCampaignStatusUpdate {
  campaignId: string;
  status: 'ACTIVE' | 'PAUSED';
}

export interface MetaExperimentAccountIdentity {
  accountId: string;
  businessId: string;
}

export interface MetaSplitTestInput {
  businessId: string;
  name: string;
  description: string;
  startTime: number;
  endTime: number;
  control: { campaignId: string; name: string; allocationPercent: number };
  treatment: { campaignId: string; name: string; allocationPercent: number };
}

export interface MetaSplitTestSnapshot {
  studyId: string;
  businessId: string;
  name: string;
  type: string;
  startTime: string;
  endTime: string;
  canceledTime: string | null;
  cells: Array<{ cellId: string; name: string; allocationPercent: number; campaignIds: string[] }>;
}

export interface MetaCreativePerformanceRow extends Record<string, unknown> {
  ad_id: string;
  creative_id: string;
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

  async listCampaigns(limit = 100): Promise<MetaCampaignOption[]> {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const account = new this.sdk.AdAccount(this.accountId, {}, undefined, this.api);
    if (typeof account.getCampaigns !== 'function') throw new Error('Meta campaign discovery is unavailable.');
    const response = await account.getCampaigns([
      'id', 'account_id', 'name', 'objective', 'configured_status', 'effective_status',
    ], { limit: boundedLimit });
    const rows = Array.isArray(response) ? response : [];
    return rows.slice(0, boundedLimit).map((value) => {
      const record = plainData(value);
      return {
        campaignId: text(record.id),
        campaignName: text(record.name) || text(record.id),
        accountId: text(record.account_id),
        objective: text(record.objective),
        configuredStatus: text(record.configured_status),
        effectiveStatus: text(record.effective_status),
      };
    }).filter((campaign) => campaign.campaignId && campaign.accountId);
  }

  async getExperimentAccountIdentity(): Promise<MetaExperimentAccountIdentity> {
    const record = await this.read(new this.sdk.AdAccount(this.accountId, {}, undefined, this.api), [
      'id', 'account_id', 'business', 'owner_business',
    ]);
    const business = plainData(record.business || record.owner_business);
    const businessId = text(business.id) || text(record.business) || text(record.owner_business);
    if (!businessId) throw new Error('The connected Meta ad account has no readable owning Business Manager.');
    return { accountId: text(record.account_id) || this.accountId.replace(/^act_/, ''), businessId };
  }

  async getCampaignStatuses(campaignIds: string[]): Promise<MetaCampaignOption[]> {
    const ids = [...new Set(campaignIds.map(text).filter(Boolean))];
    if (ids.length === 0) throw new Error('At least one Meta campaign ID is required.');
    return Promise.all(ids.map(async (campaignId) => {
      const record = await this.read(new this.sdk.Campaign(campaignId, {}, undefined, this.api), [
        'id', 'account_id', 'name', 'objective', 'configured_status', 'effective_status',
      ]);
      return {
        campaignId: text(record.id) || campaignId,
        campaignName: text(record.name) || campaignId,
        accountId: text(record.account_id),
        objective: text(record.objective),
        configuredStatus: text(record.configured_status),
        effectiveStatus: text(record.effective_status),
      };
    }));
  }

  async getCreativePerformance(startDate: string, endDate: string): Promise<MetaCreativePerformanceRow[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
      throw new Error('Meta creative performance requires a valid increasing date range.');
    }
    const account = new this.sdk.AdAccount(this.accountId, {}, undefined, this.api);
    if (typeof account.getAds !== 'function' || typeof account.getInsights !== 'function') {
      throw new Error('Meta creative performance reads are unavailable.');
    }
    const adsResponse = await account.getAds([
      'id', 'name', 'campaign_id', 'adset_id', 'configured_status', 'effective_status',
      'creative{id,name,body,title,object_story_id,image_hash,video_id,call_to_action_type}',
    ], { limit: 500 });
    const metadata = new Map((Array.isArray(adsResponse) ? adsResponse : []).map((value) => {
      const ad = plainData(value);
      return [text(ad.id), ad] as const;
    }).filter(([id]) => id));
    const insightsResponse = await account.getInsights([
      'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
      'spend', 'impressions', 'clicks', 'reach', 'frequency', 'actions', 'action_values',
      'video_thruplay_watched_actions', 'account_currency', 'date_start', 'date_stop',
    ], {
      level: 'ad', time_range: { since: startDate, until: endDate }, time_increment: 1, limit: 500,
    });
    return (Array.isArray(insightsResponse) ? insightsResponse : []).map((value) => {
      const insight = plainData(value);
      const ad = metadata.get(text(insight.ad_id)) ?? {};
      const creative = plainData(ad.creative);
      return {
        ...insight,
        creative_id: text(creative.id),
        creative_format: text(creative.call_to_action_type),
        body: text(creative.body),
        title: text(creative.title),
        object_story_id: text(creative.object_story_id),
        image_hash: text(creative.image_hash),
        video_id: text(creative.video_id),
        effective_status: text(ad.effective_status),
      };
    }).filter((row) => text(row.ad_id));
  }

  async updateCampaignStatuses(changes: MetaCampaignStatusUpdate[]): Promise<unknown[]> {
    if (changes.length === 0) throw new Error('At least one Meta campaign status change is required.');
    const ids = new Set<string>();
    const validated = changes.map(({ campaignId, status }) => {
      const id = campaignId.trim();
      if (!id) throw new Error('Meta campaign ID is required.');
      if (ids.has(id)) throw new Error('Meta campaign status changes must use distinct campaign IDs.');
      ids.add(id);
      if (status !== 'ACTIVE' && status !== 'PAUSED') throw new Error('Meta campaign status must be ACTIVE or PAUSED.');
      return { campaignId: id, status };
    });
    return Promise.all(validated.map(({ campaignId, status }) => (
      new this.sdk.Campaign(campaignId, {}, undefined, this.api).update([], { status })
    )));
  }

  async createSplitTest(input: MetaSplitTestInput): Promise<MetaSplitTestSnapshot> {
    const businessId = input.businessId.trim();
    const name = input.name.trim();
    const variants = [input.control, input.treatment].map((variant) => ({
      campaignId: variant.campaignId.trim(), name: variant.name.trim(), allocationPercent: variant.allocationPercent,
    }));
    if (!/^\d+$/.test(businessId)) throw new Error('Meta Business Manager ID must contain digits only.');
    if (!name) throw new Error('Meta split-test name is required.');
    if (!Number.isSafeInteger(input.startTime) || !Number.isSafeInteger(input.endTime) || input.startTime >= input.endTime) {
      throw new Error('Meta split-test timestamps must be increasing epoch seconds.');
    }
    if (variants.some((variant) => !variant.campaignId || !variant.name)) throw new Error('Each Meta split-test cell requires a campaign ID and name.');
    if (variants[0].campaignId === variants[1].campaignId) throw new Error('Meta split-test cells must use distinct campaign IDs.');
    if (variants.some(({ allocationPercent }) => !Number.isSafeInteger(allocationPercent) || allocationPercent < 10)
      || variants.reduce((sum, variant) => sum + variant.allocationPercent, 0) !== 100) {
      throw new Error('Meta split-test allocations must be integer percentages of at least 10 that total 100.');
    }
    const business = new this.sdk.Business(businessId, {}, undefined, this.api);
    if (typeof business.createAdStudy !== 'function') throw new Error('Meta split-test creation is unavailable.');
    const created = plainData(await business.createAdStudy(['id'], {
      name,
      description: input.description.trim(),
      start_time: input.startTime,
      end_time: input.endTime,
      type: 'SPLIT_TEST',
      cells: variants.map((variant) => ({
        name: variant.name,
        treatment_percentage: variant.allocationPercent,
        campaigns: [variant.campaignId],
      })),
    }));
    const studyId = text(created.id);
    if (!studyId) throw new Error('Meta created the split test without returning a study ID.');
    return this.getSplitTest(studyId);
  }

  async findSplitTestByName(businessId: string, name: string): Promise<MetaSplitTestSnapshot | null> {
    const id = businessId.trim();
    const expectedName = name.trim();
    if (!/^\d+$/.test(id)) throw new Error('Meta Business Manager ID must contain digits only.');
    if (!expectedName) throw new Error('Meta split-test name is required.');
    const business = new this.sdk.Business(id, {}, undefined, this.api);
    if (typeof business.getAdStudies !== 'function') throw new Error('Meta split-test discovery is unavailable.');
    const response = await business.getAdStudies(['id', 'name', 'type', 'start_time', 'end_time', 'canceled_time'], { limit: 100 });
    const matches = (Array.isArray(response) ? response : []).map(plainData)
      .filter((study) => text(study.name) === expectedName && text(study.type) === 'SPLIT_TEST');
    if (matches.length > 1) throw new Error('Multiple Meta split tests match the execution identity; manual review is required.');
    const studyId = text(matches[0]?.id);
    return studyId ? this.getSplitTest(studyId) : null;
  }

  async getSplitTest(studyId: string): Promise<MetaSplitTestSnapshot> {
    const id = studyId.trim();
    if (!id) throw new Error('Meta ad study ID is required.');
    const study = new this.sdk.AdStudy(id, {}, undefined, this.api);
    const record = await this.read(study, ['id', 'business', 'name', 'type', 'start_time', 'end_time', 'canceled_time']);
    if (typeof study.getCells !== 'function') throw new Error('Meta split-test cell read-back is unavailable.');
    const response = await study.getCells(['id', 'name', 'treatment_percentage', 'campaigns'], {});
    const cells = (Array.isArray(response) ? response : []).map((value) => {
      const cell = plainData(value);
      const campaignsValue = plainData(cell.campaigns);
      const campaignRows = Array.isArray(campaignsValue.data) ? campaignsValue.data : [];
      return {
        cellId: text(cell.id),
        name: text(cell.name),
        allocationPercent: integer(cell.treatment_percentage) ?? 0,
        campaignIds: campaignRows.map((campaign) => text(plainData(campaign).id)).filter(Boolean).sort(),
      };
    }).sort((left, right) => left.cellId.localeCompare(right.cellId));
    const business = plainData(record.business);
    return {
      studyId: text(record.id) || id,
      businessId: text(business.id) || text(record.business),
      name: text(record.name),
      type: text(record.type),
      startTime: text(record.start_time),
      endTime: text(record.end_time),
      canceledTime: text(record.canceled_time) || null,
      cells,
    };
  }

  async cancelSplitTest(studyId: string): Promise<unknown> {
    const id = studyId.trim();
    if (!id) throw new Error('Meta ad study ID is required.');
    const study = new this.sdk.AdStudy(id, {}, undefined, this.api);
    if (typeof study.delete !== 'function') throw new Error('Meta split-test cancellation is unavailable.');
    return study.delete([], {});
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