import { describe, expect, it } from 'vitest';
import {
  IMS_AUTOMATION_VIEW_IDS, MARKETING_NAV_ITEMS, canAccessImsAutomationView,
  canAccessImsTestFeature, isImsTestFeatureApi, legacyDashboardDestination,
} from '../imsAutomationNavigation';

const enabled = { 'foresight.marketing': true, 'ims.ai-helper': true };

describe('IMS automation navigation', () => {
  it.each(['Admin', 'StandardUser', 'Advisor', 'PosManager', 'PosUser', undefined])(
    'never exposes test features to %s even for an enabled business', tier => {
      expect(canAccessImsTestFeature(tier, enabled, 'ims.ai-helper')).toBe(false);
      for (const view of ['ai-helper', ...MARKETING_NAV_ITEMS.map(item => item.id)] as const) {
        expect(canAccessImsAutomationView(view, tier, enabled, true)).toBe(false);
      }
    },
  );

  it('requires an explicit switch even for SuperAdmins', () => {
    expect(canAccessImsTestFeature('SuperAdmin', undefined, 'ims.ai-helper')).toBe(false);
    expect(canAccessImsTestFeature('SuperAdmin', { 'ims.ai-helper': false }, 'ims.ai-helper')).toBe(false);
    expect(canAccessImsTestFeature('SuperAdmin', enabled, 'ims.ai-helper')).toBe(true);
    expect(canAccessImsTestFeature('SuperAdmin', enabled, 'foresight.marketing')).toBe(true);
  });

  it('preserves ordinary reports and automation access independently of test switches', () => {
    expect(canAccessImsAutomationView('stock-turnover', 'StandardUser', undefined, false)).toBe(true);
    expect(canAccessImsAutomationView('brand-profile', 'Admin', undefined, false)).toBe(true);
    expect(canAccessImsAutomationView('pending-online', 'Admin', undefined, false)).toBe(false);
    expect(canAccessImsAutomationView('pending-online', 'Admin', undefined, true)).toBe(true);
  });

  it('keeps every existing workspace link and its query parameters in IMS', () => {
    for (const view of IMS_AUTOMATION_VIEW_IDS) {
      expect(legacyDashboardDestination(`#${view}?id=42`, '')).toBe(`/ims#${view}?id=42`);
    }
    expect(legacyDashboardDestination('#home', '')).toBe('/ims#dashboard');
    expect(legacyDashboardDestination('#marketing', '')).toBe('/ims#marketing-assistant');
    expect(legacyDashboardDestination('', '?settings=connections')).toBe('/ims#settings-connections');
    expect(legacyDashboardDestination('', '?settings=product-description-template')).toBe('/ims#product-description-template');
  });

  it('covers all test API families without blocking background cron or ordinary IMS', () => {
    for (const pathname of ['/api/ai/ask', '/api/ai/chat-summary', '/api/foresight/planning/threads', '/api/foresight/creatives/1/media', '/api/sync/marketing', '/api/user/marketing-settings']) {
      expect(isImsTestFeatureApi(pathname)).toBe(true);
    }
    expect(isImsTestFeatureApi('/api/foresight/digests/cron')).toBe(false);
    expect(isImsTestFeatureApi('/api/ims/assistant/chat')).toBe(false);
    expect(isImsTestFeatureApi('/api/ai/brand-asset-chat')).toBe(false);
  });
});
