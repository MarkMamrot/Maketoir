exports.id=1118,exports.ids=[1118,7498,2827],exports.modules={17498:e=>{function s(e){var s=Error("Cannot find module '"+e+"'");throw s.code="MODULE_NOT_FOUND",s}s.keys=()=>[],s.resolve=s,s.id=17498,e.exports=s},62849:e=>{function s(e){var s=Error("Cannot find module '"+e+"'");throw s.code="MODULE_NOT_FOUND",s}s.keys=()=>[],s.resolve=s,s.id=62849,e.exports=s},40611:(e,s,t)=>{"use strict";t.d(s,{I:()=>i});var r=t(65037);let i={getAll:async e=>Object.fromEntries((await (0,r.IO)("SELECT `key`, value FROM config WHERE business_id = ?",[e])).map(e=>[e.key,e.value])),async get(e,s){let t=await (0,r.IO)("SELECT value FROM config WHERE business_id = ? AND `key` = ?",[e,s]);return t[0]?.value??null},async set(e,s,t){await (0,r.ht)("INSERT INTO config (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()",[e,s,t])},async delete(e,s){await (0,r.ht)("DELETE FROM config WHERE business_id = ? AND `key` = ?",[e,s])}}},35857:(e,s,t)=>{"use strict";t.d(s,{m2:()=>n,vg:()=>a});var r=t(65037);let i={Cin7AccountId:"cin7_account_id",Cin7ApiKey:"cin7_api_key",ShopifyShopId:"shopify_shop_id",ShopifyAccessToken:"shopify_access_token",MetaAdAccountId:"meta_ad_account_id",MetaAccessToken:"meta_access_token",GoogleAdsCustomerId:"google_ads_customer_id",GoogleAdsRefreshToken:"google_ads_refresh_token",KlaviyoApiKey:"klaviyo_api_key",GmailAddress:"gmail_email",GmailRefreshToken:"gmail_refresh_token",WebsiteSheetId:"website_sheet_id",GA4PropertyId:"ga4_property_id",GeminiModel:"gemini_model",XeroTenantId:"xero_tenant_id",XeroTenantName:"xero_tenant_name",XeroTokenExpiry:"xero_token_expiry"},n=new Set(["ShopifyAccessToken","MetaAccessToken","Cin7ApiKey","GmailRefreshToken","KlaviyoApiKey","GoogleAdsRefreshToken"]),a={get:async e=>(await (0,r.IO)("SELECT * FROM connections WHERE business_id = ?",[e]))[0]??null,async saveFromLegacy(e,s){let t={};for(let[e,r]of Object.entries(s)){let s=i[e];s&&(t[s]=r||null)}await a.upsert(e,t)},async getLegacy(e){let s=await a.get(e);if(!s)return{};let t={};for(let[e,r]of Object.entries(i))t[e]=s[r]??"";return t},async upsert(e,s){let t=Object.keys(s);if(0===t.length)return;let i=t.map(e=>`${e} = VALUES(${e})`).join(", "),n=t.map(e=>s[e]??null);await (0,r.ht)(`INSERT INTO connections (business_id, ${t.join(", ")})
       VALUES (?, ${t.map(()=>"?").join(", ")})
       ON DUPLICATE KEY UPDATE ${i}, updated_at = NOW()`,[e,...n])}}},48576:(e,s,t)=>{"use strict";t.d(s,{H:()=>a,p:()=>c});var r=t(84770);let i="aes-256-gcm";function n(){let e=process.env.ENCRYPTION_KEY;if(!e||64!==e.length)throw Error("ENCRYPTION_KEY must be a 64-character hex string in .env");return Buffer.from(e,"hex")}function a(e){if(!e)return"";let s=n(),t=(0,r.randomBytes)(12),a=(0,r.createCipheriv)(i,s,t),c=Buffer.concat([a.update(e,"utf8"),a.final()]),o=a.getAuthTag();return`${t.toString("hex")}:${o.toString("hex")}:${c.toString("hex")}`}function c(e){if(!e)return"";if(!function(e){let s=e.split(":");if(3!==s.length)return!1;let[t,r]=s;return 24===t.length&&32===r.length&&/^[0-9a-f]+$/i.test(t)&&/^[0-9a-f]+$/i.test(r)}(e))return e;let[s,t,a]=e.split(":"),c=n(),o=(0,r.createDecipheriv)(i,c,Buffer.from(s,"hex"));return o.setAuthTag(Buffer.from(t,"hex")),Buffer.concat([o.update(Buffer.from(a,"hex")),o.final()]).toString("utf8")}},8178:(e,s,t)=>{"use strict";t.d(s,{B:()=>i});var r=t(26253);class i{constructor(e,s){this.client=new r.GoogleAdsApi({client_id:process.env.GOOGLE_ADS_CLIENT_ID||"",client_secret:process.env.GOOGLE_ADS_CLIENT_SECRET||"",developer_token:process.env.GOOGLE_ADS_DEVELOPER_TOKEN||""});let t=(process.env.GOOGLE_ADS_CUSTOMER_ID||"").replace(/-/g,"");this.customerId=e?e.replace(/-/g,""):t,this.refreshToken=s??process.env.GOOGLE_ADS_REFRESH_TOKEN??""}getCustomer(){return this.client.Customer({customer_id:this.customerId,refresh_token:this.refreshToken})}async getLivePerformanceMetrics(e,s){return this.getCustomer().query(`
      SELECT metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${e}' AND '${s}'
    `)}async getCampaigns(e,s){return this.getCustomer().query(`
      SELECT
        campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
        campaign.bidding_strategy_type,
        campaign_budget.amount_micros,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value,
        metrics.ctr, metrics.average_cpc
      FROM campaign
      WHERE segments.date BETWEEN '${e}' AND '${s}'
        AND campaign.status != 'REMOVED'
    `)}async getAdGroups(e,s){return this.getCustomer().query(`
      SELECT
        campaign.id, campaign.name,
        ad_group.id, ad_group.name, ad_group.status, ad_group.type,
        ad_group.cpc_bid_micros,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr
      FROM ad_group
      WHERE segments.date BETWEEN '${e}' AND '${s}'
        AND ad_group.status != 'REMOVED'
    `)}async getKeywords(e,s){return this.getCustomer().query(`
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
      WHERE segments.date BETWEEN '${e}' AND '${s}'
        AND ad_group_criterion.status != 'REMOVED'
    `)}async getSearchTerms(e,s){return this.getCustomer().query(`
      SELECT
        campaign.name, ad_group.name,
        search_term_view.search_term, search_term_view.status,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr
      FROM search_term_view
      WHERE segments.date BETWEEN '${e}' AND '${s}'
    `)}async getAds(e,s){return this.getCustomer().query(`
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
      WHERE segments.date BETWEEN '${e}' AND '${s}'
        AND ad_group_ad.status != 'REMOVED'
    `)}async getAssetPerformance(e,s){return this.getCustomer().query(`
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
      WHERE segments.date BETWEEN '${e}' AND '${s}'
    `)}async getShopping(e,s){return this.getCustomer().query(`
      SELECT
        campaign.name,
        segments.product_title, segments.product_brand, segments.product_type_l1,
        segments.product_item_id,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr
      FROM shopping_performance_view
      WHERE segments.date BETWEEN '${e}' AND '${s}'
    `)}async getWeeklyTrend(e,s){return this.getCustomer().query(`
      SELECT
        campaign.name,
        segments.week,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr
      FROM campaign
      WHERE segments.date BETWEEN '${e}' AND '${s}'
    `)}async getDaypart(e,s){return this.getCustomer().query(`
      SELECT
        campaign.name,
        segments.hour, segments.day_of_week,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${e}' AND '${s}'
    `)}async getByDevice(e,s){return this.getCustomer().query(`
      SELECT
        campaign.name, segments.device,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${e}' AND '${s}'
    `)}async getByGeo(e,s){return this.getCustomer().query(`
      SELECT
        campaign.name,
        geographic_view.country_criterion_id, geographic_view.location_type,
        segments.geo_target_region,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value
      FROM geographic_view
      WHERE segments.date BETWEEN '${e}' AND '${s}'
    `)}async getAudiences(e,s){return this.getCustomer().query(`
      SELECT
        campaign.name, ad_group.name,
        ad_group_criterion.criterion_id,
        ad_group_criterion.type,
        ad_group_criterion.bid_modifier,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value
      FROM ad_group_audience_view
      WHERE segments.date BETWEEN '${e}' AND '${s}'
    `)}async getConversionActions(e,s){return this.getCustomer().query(`
      SELECT
        campaign.name,
        segments.conversion_action_name,
        segments.conversion_action_category,
        metrics.conversions, metrics.conversions_value,
        metrics.all_conversions, metrics.all_conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${e}' AND '${s}'
    `)}async getAuctionInsights(e,s){return this.getCustomer().query(`
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
    `)}async getLandingPages(e,s){return this.getCustomer().query(`
      SELECT
        campaign.name, ad_group.name,
        landing_page_view.unexpanded_final_url,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value,
        metrics.speed_score, metrics.mobile_friendly_clicks_percentage
      FROM landing_page_view
      WHERE segments.date BETWEEN '${e}' AND '${s}'
    `)}async getYearlyTrend(e,s){return this.getCustomer().query(`
      SELECT
        segments.month,
        campaign.name, campaign.advertising_channel_type,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.ctr
      FROM campaign
      WHERE segments.date BETWEEN '${e}' AND '${s}'
        AND campaign.status != 'REMOVED'
    `)}async deployPMaxAssets(e,s){let t=s.filter(e=>"text"===e.type),r=s.filter(e=>"image"===e.type),i=s.filter(e=>"video"===e.type);return console.log(`Setting up PMax Asset Group for ${e}...`,{texts:t.length,images:r.length,videos:i.length}),"pmax-asset-group-id"}}},65037:(e,s,t)=>{"use strict";t.d(s,{IO:()=>a,Mj:()=>n,ht:()=>c});var r=t(73785);let i=null;function n(){return i||(i=r.createPool({host:process.env.MYSQL_HOST??"localhost",port:parseInt(process.env.MYSQL_PORT??"3306",10),database:process.env.MYSQL_DATABASE??"",user:process.env.MYSQL_USER??"",password:process.env.MYSQL_PASSWORD??"",waitForConnections:!0,connectionLimit:5,queueLimit:0,timezone:"Z",charset:"utf8mb4"})),i}async function a(e,s){let[t]=await n().execute(e,s);return t}async function c(e,s){let[t]=await n().execute(e,s);return t}}};