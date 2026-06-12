export type AiDataSource = {
  id: string;
  label: string;
  icon: string;
  desc: string;
};

export const AI_DATA_SOURCES: AiDataSource[] = [
  { id: 'businessInfo', label: 'Business Info', icon: '🏢', desc: 'Brand name, website, social links — embedded as text' },
  { id: 'brandProfile', label: 'Brand Profile', icon: '🎨', desc: 'Mission, UVP, tone, demographics, competitors — embedded as text' },
  { id: 'products', label: 'Products', icon: '🛍️', desc: 'Full product catalogue as CSV — inline or via Gemini File API' },
  { id: 'sales', label: 'Sales', icon: '💰', desc: 'Full sales history as CSV — inline or via Gemini File API' },
  { id: 'analytics', label: 'Analytics', icon: '📈', desc: 'Live GA4 website analytics as CSV' },
  { id: 'googleAds', label: 'Google Ads', icon: '📊', desc: 'Live Google Ads campaign data as CSV' },
  { id: 'metaAds', label: 'Meta Ads', icon: '📱', desc: 'Live Meta campaign data as CSV' },
  { id: 'website', label: 'Website Products', icon: '🌐', desc: 'Full Shopify product listings as CSV — inline or via Gemini File API' },
  { id: 'websiteCollections', label: 'Website Collections', icon: '📂', desc: 'Shopify collection names and URLs' },
  { id: 'cin7Api', label: 'Cin7 API Spec', icon: '📖', desc: 'Full Cin7 OpenAPI spec as JSON — for writing scripts & integrations' },
  { id: 'googleAdsApi', label: 'Google Ads Field Schema', icon: '📖', desc: 'All queryable GAQL fields — for writing Google Ads scripts & reports' },
  { id: 'metaApi', label: 'Meta Ads API Schema', icon: '📖', desc: 'Meta Marketing API field definitions — for writing Meta automation scripts' },
];
