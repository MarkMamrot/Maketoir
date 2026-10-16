export const FEATURE_TOGGLES = [
  { key: 'feature_toggle_consignments', label: 'Consignments', group: 'Purchasing', defaultEnabled: false, description: 'Show Consignment Activity in Reports and Consignment Statements in Purchasing. Settlement tracking is optional and controlled separately; hiding these screens does not change stock ownership or accounting treatment.' },
  { key: 'feature_toggle_consignment_tracking', label: 'Consignment Tracking', group: 'Purchasing', defaultEnabled: false, description: 'Optional managed settlement statements. Requires an acknowledged cutover or disable handover. With Consignments enabled, activity reporting and read-only statements remain available when tracking is off; ownership and accounting treatment are unchanged.' },
  { key: 'feature_toggle_shipping', label: 'Shipping Workspace', group: 'Workspaces', description: 'Prepare and ship sales orders in the Shipping Workspace.' },
  { key: 'feature_toggle_crm', label: 'CRM', group: 'Workspaces', description: 'Customer profiles, follow-ups, pipeline and CRM analytics. The normal Contacts list remains available.' },
  { key: 'feature_toggle_customs', label: 'Customs & compliance', group: 'Products & Channels', description: 'Customs descriptions, tariff codes, country of origin and restricted-goods controls in the product editor.' },
  { key: 'feature_toggle_channel_rules', label: 'Channel Listing Rules', group: 'Products & Channels', description: 'Channel product-rule editors, rule filters and Apply Rules controls. Manual channel publishing remains available.' },
  { key: 'feature_toggle_bulk_edit', label: 'Bulk Edit', group: 'Products & Channels', description: 'The Bulk Edit products workspace. Bulk Add/Edit is separate and stays available.' },
  { key: 'feature_toggle_inactive_candidates', label: 'Inactive Candidates', group: 'Reports', description: 'Review products that may be ready to mark inactive.' },
  { key: 'feature_toggle_space_efficiency', label: 'Space Efficiency', group: 'Reports', description: 'Review stock space usage and efficiency.' },
  { key: 'feature_toggle_possible_losses', label: 'Possible Losses', group: 'Reports', description: 'Review products flagged as potential stock losses.' },
  { key: 'feature_toggle_customer_service', label: 'Customer Service', group: 'Automations', description: 'The Customer Service group, including Inbox, Compose Email and Email Templates.' },
] as const;

export type FeatureToggleKey = typeof FEATURE_TOGGLES[number]['key'];
export const FEATURE_TOGGLE_KEYS = FEATURE_TOGGLES.map(feature => feature.key);

export function isFeatureEnabled(settings: Readonly<Record<string, string>>, key: FeatureToggleKey): boolean {
  const feature = FEATURE_TOGGLES.find(item => item.key === key);
  const defaultEnabled = feature && 'defaultEnabled' in feature ? feature.defaultEnabled : true;
  return defaultEnabled ? settings[key] !== 'no' : settings[key] === 'yes';
}

export function featureForView(view: string): FeatureToggleKey | undefined {
  const views: Record<string, FeatureToggleKey> = {
    'report-consignment-activity': 'feature_toggle_consignments',
    'consignment-statements': 'feature_toggle_consignments',
    crm: 'feature_toggle_crm',
    'contact-profile': 'feature_toggle_crm',
    'bulk-edit': 'feature_toggle_bulk_edit',
    'inactive-candidates': 'feature_toggle_inactive_candidates',
    'space-analysis': 'feature_toggle_space_efficiency',
    'lost-candidates': 'feature_toggle_possible_losses',
    '__customer-service': 'feature_toggle_customer_service',
    'cs-inbox': 'feature_toggle_customer_service',
    'cs-compose': 'feature_toggle_customer_service',
    'cs-templates': 'feature_toggle_customer_service',
  };
  return Object.prototype.hasOwnProperty.call(views, view) ? views[view] : undefined;
}

export function isFeatureViewEnabled(settings: Readonly<Record<string, string>>, view: string): boolean {
  const key = featureForView(view);
  return !key || isFeatureEnabled(settings, key);
}
