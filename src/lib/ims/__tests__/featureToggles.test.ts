import { describe, expect, it } from 'vitest';
import { FEATURE_TOGGLE_KEYS, FEATURE_TOGGLES, featureForView, isFeatureEnabled, isFeatureViewEnabled } from '../featureToggles';

describe('tenant feature toggles', () => {
  it('preserves nine default-on switches and defaults consignment visibility and tracking off', () => {
    expect(FEATURE_TOGGLES).toHaveLength(11);
    expect(new Set(FEATURE_TOGGLE_KEYS).size).toBe(11);
    for (const key of FEATURE_TOGGLE_KEYS) {
      expect(isFeatureEnabled({}, key)).toBe(!['feature_toggle_consignments', 'feature_toggle_consignment_tracking'].includes(key));
      expect(isFeatureEnabled({ [key]: 'yes' }, key)).toBe(true);
      expect(isFeatureEnabled({ [key]: 'no' }, key)).toBe(false);
    }
  });

  it('requires explicit yes for tracking and keeps it independent of screen visibility', () => {
    expect(isFeatureEnabled({ feature_toggle_consignment_tracking: '' }, 'feature_toggle_consignment_tracking')).toBe(false);
    expect(isFeatureEnabled({ feature_toggle_consignment_tracking: 'true' }, 'feature_toggle_consignment_tracking')).toBe(false);
    expect(isFeatureEnabled({ feature_toggle_consignments: 'yes' }, 'feature_toggle_consignment_tracking')).toBe(false);
  });

  it.each(['report-consignment-activity', 'consignment-statements'])('requires explicit business opt-in for %s, independently of tracking', view => {
    expect(featureForView(view)).toBe('feature_toggle_consignments');
    for (const value of [undefined, '', 'true', 'no']) {
      const settings: Record<string, string> = value === undefined ? {} : { feature_toggle_consignments: value };
      expect(isFeatureViewEnabled(settings, view)).toBe(false);
    }
    expect(isFeatureViewEnabled({ feature_toggle_consignment_tracking: 'yes' }, view)).toBe(false);
    expect(isFeatureViewEnabled({ feature_toggle_consignments: 'yes', feature_toggle_consignment_tracking: 'no' }, view)).toBe(true);
    expect(isFeatureViewEnabled({ feature_toggle_consignments: 'no', feature_toggle_consignment_tracking: 'yes' }, view)).toBe(false);
  });

  it.each([
    ['crm', 'feature_toggle_crm'], ['contact-profile', 'feature_toggle_crm'],
    ['bulk-edit', 'feature_toggle_bulk_edit'],
    ['inactive-candidates', 'feature_toggle_inactive_candidates'],
    ['space-analysis', 'feature_toggle_space_efficiency'],
    ['lost-candidates', 'feature_toggle_possible_losses'],
    ['__customer-service', 'feature_toggle_customer_service'],
    ['cs-inbox', 'feature_toggle_customer_service'],
    ['cs-compose', 'feature_toggle_customer_service'],
    ['cs-templates', 'feature_toggle_customer_service'],
  ])('guards the %s destination without changing unrelated features', (view, key) => {
    expect(featureForView(view)).toBe(key);
    expect(isFeatureViewEnabled({}, view)).toBe(true);
    expect(isFeatureViewEnabled({ [key]: 'no' }, view)).toBe(false);
    expect(isFeatureViewEnabled({ [key]: 'no' }, 'dashboard')).toBe(true);
  });

  it('never disables Bulk Add/Edit, Contacts or the entire Reports section', () => {
    const settings = Object.fromEntries(FEATURE_TOGGLE_KEYS.map(key => [key, 'no']));
    for (const view of ['bulk-add-edit', 'contacts', 'reports', 'report-sales-by-branch', 'stock-turnover']) {
      expect(isFeatureViewEnabled(settings, view)).toBe(true);
    }
    expect(featureForView('constructor')).toBeUndefined();
  });

  it('does not share switch state between tenants', () => {
    expect(isFeatureViewEnabled({ feature_toggle_crm: 'no' }, 'crm')).toBe(false);
    expect(isFeatureViewEnabled({ feature_toggle_crm: 'yes' }, 'crm')).toBe(true);
    expect(isFeatureViewEnabled({}, 'crm')).toBe(true);
  });
});
