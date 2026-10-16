export interface SettingsItem {
  id: string;
  label: string;
  description?: string;
  children?: readonly SettingsItem[];
  superAdminOnly?: boolean;
  buildsOnly?: boolean;
}

export const IMS_SETTINGS_MENU = [
  { id: 'business', label: 'Business & Team', children: [
    { id: 'business-profile', label: 'Business profile', description: 'Business identity, contact details and document logo.' },
    { id: 'general', label: 'Business operations', description: 'Choose the workflows and inventory capabilities this business uses.' },
    { id: 'feature-toggle', label: 'Feature Toggle', description: 'Show or hide optional tools for everyone in this business. Only administrators can change these switches.' },
    { id: 'tax', label: 'Tax rates & labels', description: 'Rates and labels for Solvantis documents. Prices remain tax-inclusive.' },
    { id: 'users', label: 'Users', description: 'Manage the people who can access this business.' },
    { id: 'advisor-access', label: 'Advisor permissions', description: 'Choose which inventory and accounting actions Advisors may perform.' },
    { id: 'accounts-email', label: 'Bookkeeping email', description: 'Shared accounts recipients for reconciliation and register correction notices.' },
  ] },
  { id: 'inventory', label: 'Inventory & Locations', children: [
    { id: 'products', label: 'Product fields', description: 'Optional catalogue fields and opening-stock controls.' },
    { id: 'locations', label: 'Location defaults', description: 'Default warehouse and location behaviour.' },
    { id: 'online-pick', label: 'Online picking priority', description: 'Existing business-wide online location priority. Store-specific routing remains in Sales Channels.' },
    { id: 'builds', label: 'Build policies', buildsOnly: true, description: 'Business and location policies for reviewed build-from-sale offers.' },
    { id: 'inventory-costing', label: 'Inventory costing', description: 'Review stock valuation and use the controlled prospective costing switch.' },
    { id: 'initial-import', label: 'Opening stock imports', description: 'Initial stock snapshot, costs and replenishment imports. Review each warning before applying.' },
  ] },
  { id: 'purchasing', label: 'Purchasing', children: [
    { id: 'purchase-documents', label: 'Purchase order documents', children: [
      { id: 'purchase-orders', label: 'Email template' },
      { id: 'purchase-pdf', label: 'PDF terms & freight' },
    ] },
    { id: 'purchase-payments', label: 'Payment methods' },
    { id: 'currencies', label: 'Foreign currencies' },
  ] },
  { id: 'sales', label: 'Sales & Customers', children: [
    { id: 'sales-documents', label: 'Sales order documents', children: [
      { id: 'sales-orders', label: 'Email template' },
      { id: 'sales-pdf', label: 'PDF appearance & terms' },
    ] },
    { id: 'sales-payments', label: 'Payment methods' },
    { id: 'payment-discounts', label: 'Early-payment discounts', description: 'Shared early-payment terms for suppliers, customers and orders.' },
    { id: 'shipping', label: 'Shipping' },
    { id: 'loyalty-group', label: 'Loyalty', children: [
      { id: 'loyalty', label: 'Program & earning' },
      { id: 'loyalty-rewards', label: 'Rewards' },
      { id: 'loyalty-portal', label: 'Customer portal' },
    ] },
    { id: 'wholesale-group', label: 'Wholesale portal', children: [
      { id: 'wholesale', label: 'Catalogue & ordering' },
      { id: 'wholesale-branding', label: 'Branding' },
      { id: 'wholesale-notifications', label: 'Notifications' },
      { id: 'wholesale-preview', label: 'Staff preview' },
    ] },
    { id: 'sales-channels', label: 'Sales channels', description: 'Enable the channels you use; configure each online store in Sales Channels.' },
  ] },
  { id: 'point-of-sale', label: 'Point of Sale', children: [
    { id: 'pos', label: 'Registers' },
    { id: 'pos-payments', label: 'Payment types & float' },
    { id: 'pos-layby', label: 'Layby cancellation fees' },
    { id: 'pos-display', label: 'Product display' },
    { id: 'pos-receipts', label: 'Receipts & gift receipts' },
    { id: 'pos-access', label: 'POS access rules' },
    { id: 'pos-terminals', label: 'Card terminals' },
  ] },
  { id: 'integrations', label: 'Integrations', children: [
    { id: 'connections', label: 'Overview', description: 'Enable an integration before connecting it. Turning it off retains its configuration and pauses dependent activity.' },
    { id: 'xero', label: 'Xero', description: 'Accounting connection and links to the existing Finances configuration.' },
    { id: 'cin7-group', label: 'Cin7 Omni', children: [
      { id: 'connection-cin7', label: 'Connection' },
      { id: 'sync', label: 'Sync & import' },
    ] },
    { id: 'connection-google', label: 'Google Ads & Analytics' },
    { id: 'connection-meta', label: 'Meta Ads' },
    { id: 'connection-klaviyo', label: 'Klaviyo' },
    { id: 'connection-gmail', label: 'Gmail' },
    { id: 'shopify', label: 'Online store configuration', description: 'Configure the exact Shopify, native or marketplace store in its owning workspace.' },
  ] },
  { id: 'ai', label: 'AI & Account', children: [
    { id: 'ai-models', label: 'AI models' },
    { id: 'ai-account', label: 'Account & AI credits' },
  ] },
  { id: 'advanced', label: 'Advanced', superAdminOnly: true, children: [
    { id: 'utilities', label: 'Data repair' },
    { id: 'data-reset', label: 'Data reset' },
    { id: 'api-tools', label: 'API tools & diagnostics' },
    { id: 'sales-cache', label: 'Sales cache maintenance' },
  ] },
] as const satisfies readonly SettingsItem[];

type LeafId<T> = T extends { children: readonly (infer Child)[] } ? LeafId<Child> : T extends { id: infer Id } ? Id : never;
export type SettingsSection = LeafId<typeof IMS_SETTINGS_MENU[number]>;

export function settingsPath(id: string, items: readonly SettingsItem[] = IMS_SETTINGS_MENU): SettingsItem[] {
  for (const item of items) {
    if (item.id === id) return [item];
    if (item.children) {
      const path = settingsPath(id, item.children);
      if (path.length) return [item, ...path];
    }
  }
  return [];
}

export function resolveSettingsSection(value: string): SettingsSection {
  if (value === 'inventory-documents') return 'general';
  const path = settingsPath(value.replace(/^settings-/, ''));
  const leaf = path[path.length - 1];
  return leaf && !leaf.children ? leaf.id as SettingsSection : 'general';
}

export function visibleSettingsMenu(input: { superAdmin: boolean; buildsEnabled: boolean }): SettingsItem[] {
  const filter = (items: readonly SettingsItem[]): SettingsItem[] => items
    .filter(item => (!item.superAdminOnly || input.superAdmin) && (!item.buildsOnly || input.buildsEnabled))
    .map(item => ({ ...item, ...(item.children ? { children: filter(item.children) } : {}) }));
  return filter(IMS_SETTINGS_MENU);
}

export function settingsOwnedUpdates(
  draft: Record<string, string>,
  saved: Record<string, string>,
  keys: readonly string[],
): Record<string, string> {
  return Object.fromEntries(keys.filter(key => (draft[key] ?? '') !== (saved[key] ?? '')).map(key => [key, draft[key] ?? '']));
}
