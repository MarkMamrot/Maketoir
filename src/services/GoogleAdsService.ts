// src/services/GoogleAdsService.ts
import { GoogleAdsApi } from 'google-ads-api';
import { StandardizedCreative } from '../types/StandardizedData';

export class GoogleAdsService {
  private client: GoogleAdsApi;
  readonly customerId: string;

  constructor(customerIdOverride?: string) {
    this.client = new GoogleAdsApi({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    });
    const envId = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
    this.customerId = customerIdOverride
      ? customerIdOverride.replace(/-/g, '')
      : envId;
  }

  private getCustomer() {
    return this.client.Customer({
      customer_id: this.customerId,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
    });
  }

  // â”€â”€ Existing method â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getLivePerformanceMetrics(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);
  }

  // â”€â”€ Campaigns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getCampaigns(startDate: string, endDate: string) {
    // Note: search impression share metrics are only valid for Search/Shopping;
    // omit them here to keep this query compatible with all campaign types.
    return this.getCustomer().query(`
      SELECT
        campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
        campaign.bidding_strategy_type,
        campaign_budget.amount_micros,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value,
        metrics.ctr, metrics.average_cpc
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status != 'REMOVED'
    `)
  }

  // -- Ad Groups -------------------------------------------------------------------
  async getAdGroups(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        campaign.id, campaign.name,
        ad_group.id, ad_group.name, ad_group.status, ad_group.type,
        ad_group.cpc_bid_micros,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr
      FROM ad_group
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND ad_group.status != 'REMOVED'
    `);
  }

  // â”€â”€ Keywords â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getKeywords(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        campaign.name, ad_group.name,
        ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
        ad_group_criterion.status, ad_group_criterion.cpc_bid_micros,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
      FROM keyword_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND ad_group_criterion.status != 'REMOVED'
    `);
  }

  // â”€â”€ Search Terms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getSearchTerms(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        campaign.name, ad_group.name,
        search_term_view.search_term, search_term_view.status,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr
      FROM search_term_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);
  }

  // â”€â”€ Ads (RSA / ETA / Responsive Display) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getAds(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        campaign.name, ad_group.name,
        ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad_strength,
        ad_group_ad.policy_summary.approval_status,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr
      FROM ad_group_ad
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND ad_group_ad.status != 'REMOVED'
    `);
  }

  // â”€â”€ RSA Asset Performance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getAssetPerformance(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        campaign.name, ad_group.name,
        ad_group_ad.ad.id,
        asset.id, asset.name, asset.type,
        asset.text_asset.text,
        ad_group_ad_asset_view.field_type,
        ad_group_ad_asset_view.performance_label,
        ad_group_ad_asset_view.enabled,
        metrics.impressions, metrics.clicks
      FROM ad_group_ad_asset_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);
  }

  // â”€â”€ Shopping (product-level) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getShopping(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        campaign.name,
        segments.product_title, segments.product_brand, segments.product_type_l1,
        segments.product_item_id,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr
      FROM shopping_performance_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);
  }

  // â”€â”€ Weekly Trend â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getWeeklyTrend(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        campaign.name,
        segments.week,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);
  }

  // â”€â”€ Dayparting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getDaypart(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        campaign.name,
        segments.hour, segments.day_of_week,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);
  }

  // â”€â”€ By Device â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getByDevice(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        campaign.name, segments.device,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);
  }

  // â”€â”€ By Geography â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getByGeo(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        campaign.name,
        geographic_view.country_criterion_id, geographic_view.location_type,
        segments.geo_target_region,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value
      FROM geographic_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);
  }

  // â”€â”€ Audiences â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getAudiences(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        campaign.name, ad_group.name,
        ad_group_criterion.criterion_id,
        ad_group_criterion.type,
        ad_group_criterion.bid_modifier,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value
      FROM ad_group_audience_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);
  }

  // â”€â”€ Conversion Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getConversionActions(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        campaign.name,
        segments.conversion_action_name,
        segments.conversion_action_category,
        metrics.conversions, metrics.conversions_value,
        metrics.all_conversions, metrics.all_conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);
  }

  // â”€â”€ Auction Insights (Competitors) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // -- Auction Insights (Competitors) --
  // NOTE: Requires Standard API access on the developer token.
  // Test/Basic tokens will get an access denied error — apply at:
  // https://developers.google.com/google-ads/api/docs/access-levels
  async getAuctionInsights(startDate: string, endDate: string) {
    // startDate/endDate are intentionally unused here: Auction Insights metrics
    // fail when combined with date segmentation/filtering in the same query.
    return this.getCustomer().query(`
      SELECT
        campaign.name,
        metrics.auction_insight_search_impression_share,
        metrics.auction_insight_search_outranking_share,
        metrics.auction_insight_search_overlap_rate,
        metrics.auction_insight_search_top_impression_percentage,
        metrics.auction_insight_search_absolute_top_impression_percentage,
        metrics.auction_insight_search_position_above_rate
      FROM campaign
      WHERE campaign.status != 'REMOVED'
    `);
  }
  // â”€â”€ Landing Pages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getLandingPages(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        campaign.name, ad_group.name,
        landing_page_view.unexpanded_final_url,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value,
        metrics.speed_score, metrics.mobile_friendly_clicks_percentage
      FROM landing_page_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `);
  }

  // -- Yearly Trend (12 months, monthly buckets for seasonality) --------------------------
  async getYearlyTrend(startDate: string, endDate: string) {
    return this.getCustomer().query(`
      SELECT
        segments.month,
        campaign.name, campaign.advertising_channel_type,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status != 'REMOVED'
    `);
  }

  // â”€â”€ PMax (legacy) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async deployPMaxAssets(campaignId: string, bundle: StandardizedCreative[]) {
    const textAssets = bundle.filter(c => c.type === 'text');
    const imageAssets = bundle.filter(c => c.type === 'image');
    const videoAssets = bundle.filter(c => c.type === 'video');
    console.log(`Setting up PMax Asset Group for ${campaignId}...`, {
      texts: textAssets.length, images: imageAssets.length, videos: videoAssets.length,
    });
    return 'pmax-asset-group-id';
  }
}

