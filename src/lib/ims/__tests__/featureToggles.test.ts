import { describe, expect, it } from 'vitest';
import { FEATURE_TOGGLE_KEYS, FEATURE_TOGGLES, featureForView, isFeatureEnabled, isFeatureViewEnabled } from '../featureToggles';

describe('tenant feature toggles', () => {
  it('preserves nine default-on switches and adds default-off consignment tracking', () => {
    expect(FEATURE_TOGGLES).toHaveLength(10);
    expect(new Set(FEATURE_TOGGLE_KEYS).size).toBe(10);
    for (const key of FEATURE_TOGGLE_KEYS) {
      expect(isFeatureEnabled({}, key)).toBe(key !== 'feature_toggle_consignment_tracking');
      expect(isFeatureEnabled({ [key]: 'yes' }, key)).toBe(true);
      expect(isFeatureEnabled({ [key]: 'no' }, key)).toBe(false);
    }
  });

  it('requires explicit yes for tracking and leaves reporting/history accessible when off', () => {
    expect(isFeatureEnabled({ feature_toggle_consignment_tracking: '' }, 'feature_toggle_consignment_tracking')).toBe(false);
    expect(isFeatureEnabled({ feature_toggle_consignment_tracking: 'true' }, 'feature_toggle_consignment_tracking')).toBe(false);
    expect(isFeatureViewEnabled({}, 'report-consignment-activity')).toBe(true);
    expect(isFeatureViewEnabled({}, 'consignment-statements')).toBe(true);
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
