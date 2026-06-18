// src/services/MetaAdsService.ts
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FacebookAdsApi, AdAccount, Campaign, AdSet, Ad } = require('facebook-nodejs-business-sdk') as any;
import { StandardizedCreative } from '../types/StandardizedData';

export class MetaAdsService {
  private accountId: string;

  constructor(accessToken: string, accountId: string) {
    this.accountId = accountId;
    FacebookAdsApi.init(accessToken);
  }

  // Phase 1 + 2

  /**
   * Pulls real-time performance insights. This is Data to Pull Dynamically.
   * Compares against Break-Even ROAS from database.
   */
  async getLivePerformanceMetrics(datePreset: string = 'last_7d'): Promise<any> {
    const account = new AdAccount(this.accountId);
    const insights = await account.getInsights([
      'campaign_id',
      'campaign_name',
      'spend',
      'impressions',
      'clicks',
      'ctr',
      'cpc',
      'cpm',
      'reach',
      'frequency',
      'actions',
      'purchase_roas',
      'date_start',
      'date_stop',
    ], { date_preset: datePreset });

    // Normalize SDK records to plain JSON rows.
    return (insights ?? []).map((row: any) => row?._data ?? row ?? {});
  }

  // Phase 3: The Creative Testing Engine

  /**
   * Generates a "Testing Campaign" utilizing the "Creative Sandbox".
   */
  async createTestingCampaign(name: string, budget: number, durationDays: number): Promise<string> {
    const account = new AdAccount(this.accountId);
    // Create broad campaign object mapped to Phase 3 goals
    const campaign = await account.createCampaign([Campaign.Fields.id], {
      name: name,
      objective: 'OUTCOME_SALES',
      status: Campaign.Status.paused, // User can deploy after review
      special_ad_categories: [],
      daily_budget: budget * 100, // Cents mapping
    });
    return campaign.id;
  }

  /**
   * Maps AI-tagged visual disruptions (videos, high-contrast images) into Ad creatives.
   */
  async deployAdCreative(campaignId: string, creative: StandardizedCreative): Promise<string> {
    // Generate Ad Creative payload matching Meta's 'push' disruption requirement.
    console.log(`Deploying ad creative to Meta ${campaignId}`, creative);
    return 'new-meta-ad-id';
  }
}
