import { describe, expect, it } from 'vitest';
import type { KlaviyoFlowRecord } from '@/services/KlaviyoService';
import { evaluateKlaviyoLifecycleRules } from '../rules/klaviyoLifecycleRules';

function flow(id: string, name: string, status = 'live', archived = 'false'): KlaviyoFlowRecord {
  return { id, name, status, archived, trigger_type: '', created: '', updated: '' };
}

describe('Klaviyo lifecycle rules', () => {
  it('emits no finding when all six critical flow categories are live', () => {
    const findings = evaluateKlaviyoLifecycleRules([
      flow('1', 'Welcome Series'),
      flow('2', 'Abandoned Checkout'),
      flow('3', 'Browse Abandonment'),
      flow('4', 'Post-Purchase Thank You'),
      flow('5', 'Customer Win-Back'),
      flow('6', 'VIP Loyalty Rewards'),
    ], 71, '2026-07-29');

    expect(findings).toEqual([]);
  });

  it('consolidates missing and inactive categories into one non-executable finding', () => {
    const findings = evaluateKlaviyoLifecycleRules([
      flow('1', 'Welcome Series'),
      flow('2', 'Abandoned Cart', 'draft'),
      flow('3', 'Post Purchase', 'live', 'true'),
      flow('4', 'VIP Rewards'),
    ], 71, '2026-07-29');
    const finding = findings[0];

    expect(finding.ruleId).toBe('klaviyo_lifecycle_coverage_gap');
    expect(finding.evidence.lifecycleFlowCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'abandoned_cart', state: 'inactive' }),
      expect.objectContaining({ category: 'browse_abandonment', state: 'missing' }),
      expect.objectContaining({ category: 'post_purchase', state: 'inactive' }),
      expect.objectContaining({ category: 'win_back', state: 'missing' }),
    ]));
    expect(finding.proposedAction.type).toBe('review_klaviyo_lifecycle_flows');
    expect(finding.proposedAction).not.toHaveProperty('revenue');
  });

  it('treats an empty successful snapshot as missing coverage, not missing data', () => {
    const finding = evaluateKlaviyoLifecycleRules([], 72, '2026-07-29')[0];

    expect(finding.evidence.observedValues).toMatchObject({
      flowCount: 0,
      missingCriticalFlowCount: 6,
    });
    expect(finding.evidence.sourceIds).toEqual(['klaviyo:flows:run-72']);
  });
});