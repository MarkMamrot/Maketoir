import type { BusinessFeatureFlags } from '@/lib/businessFeatures';

export const MARKETING_NAV_ITEMS = [
  { id: 'sync-ads', label: 'Sync Marketing Data' },
  { id: 'marketing-assistant', label: 'Marketing Assistant' },
  { id: 'planning-workspace', label: 'Planning Workspace' },
  { id: 'marketing-recommendations', label: 'Recommendation Inbox' },
  { id: 'creative-review', label: 'Creative Review' },
  { id: 'campaign-audit', label: 'Campaign Audit' },
  { id: 'marketing-settings', label: 'Marketing Settings' },
] as const;

export const IMS_AUTOMATION_VIEW_IDS = [
  ...MARKETING_NAV_ITEMS.map(item => item.id),
  'ai-helper', 'inactive-candidates', 'lost-candidates', 'space-analysis', 'stock-turnover',
  'pending-online', 'bulk-edit-listings', 'brand-assets', 'brand-assets-models',
  'brand-assets-backdrops', 'brand-assets-poses', 'brand-assets-scenes', 'brand-assets-templates',
  'business-info', 'brand-profile', 'sync-data', 'calculated-data', 'cs-inbox', 'cs-compose', 'cs-templates',
  'product-description-template',
] as const;

export type ImsAutomationView = typeof IMS_AUTOMATION_VIEW_IDS[number];

export function isImsAutomationView(value: string): value is ImsAutomationView {
  return IMS_AUTOMATION_VIEW_IDS.some(id => id === value);
}

export function canAccessImsTestFeature(
  tier: string | undefined,
  features: Partial<BusinessFeatureFlags> | undefined,
  feature: 'foresight.marketing' | 'ims.ai-helper',
): boolean {
  return tier === 'SuperAdmin' && features?.[feature] === true;
}

export function canAccessImsAutomationView(
  view: ImsAutomationView,
  tier: string | undefined,
  features: Partial<BusinessFeatureFlags> | undefined,
  shopifyEnabled: boolean,
): boolean {
  if (view === 'ai-helper') return canAccessImsTestFeature(tier, features, 'ims.ai-helper');
  if (MARKETING_NAV_ITEMS.some(item => item.id === view)) {
    return canAccessImsTestFeature(tier, features, 'foresight.marketing');
  }
  if (['pending-online', 'bulk-edit-listings', 'product-description-template'].includes(view)) {
    return shopifyEnabled;
  }
  return true;
}

export function legacyDashboardDestination(hash: string, search: string): string {
  const settings = new URLSearchParams(search).get('settings');
  if (settings === 'connections') return '/ims#settings-connections';
  if (settings === 'product-description-template') return '/ims#product-description-template';
  const view = decodeURIComponent(hash.replace(/^#/, '').split('?')[0]);
  if (isImsAutomationView(view)) return `/ims${hash}`;
  if (view === 'marketing') return '/ims#marketing-assistant';
  if (view === 'website-products' || view === 'inventory-sync') return '/ims#sync-data';
  return '/ims#dashboard';
}

export function isImsTestFeatureApi(pathname: string): boolean {
  if (pathname === '/api/foresight/digests/cron') return false;
  return pathname.startsWith('/api/foresight/')
    || [
      '/api/ai/ask', '/api/ai/chat-summary', '/api/ai/marketing-mission', '/api/ai/campaign-audit',
      '/api/user/marketing-mission', '/api/user/marketing-settings', '/api/sync/marketing',
    ].includes(pathname);
}
