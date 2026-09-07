import { describe, expect, it } from 'vitest';

import { assistantToolDefinitions, type AssistantPrincipal } from '../tools';
import {
  assistantToolAccessManifest,
  hasAssistantToolPrincipalAccess,
  isAssistantToolAvailable,
} from '../toolAccess';

const ims = (tier: 'SuperAdmin' | 'Admin' | 'StandardUser' | 'Advisor'): AssistantPrincipal => ({
  audience: 'ims', businessId: 'biz-1', userId: 7, tier,
});

describe('Assistant tool access manifest', () => {
  it('contains exactly one access rule for every registered tool', () => {
    expect(Object.keys(assistantToolAccessManifest).sort())
      .toEqual(assistantToolDefinitions.map(tool => tool.name).sort());
    for (const definition of assistantToolDefinitions) {
      expect(definition.audiences).toEqual([assistantToolAccessManifest[definition.name].audience]);
    }
  });

  it('allows Advisor read-only IMS records and reports but not integrations or Foresight', () => {
    const principal = ims('Advisor');
    expect(hasAssistantToolPrincipalAccess(principal, 'ims_product_lookup')).toBe(true);
    expect(hasAssistantToolPrincipalAccess(principal, 'ims_customer_activity')).toBe(true);
    expect(hasAssistantToolPrincipalAccess(principal, 'ims_sales_performance')).toBe(true);
    expect(hasAssistantToolPrincipalAccess(principal, 'ims_xero_sync_diagnostics')).toBe(false);
    expect(hasAssistantToolPrincipalAccess(principal, 'ims_shopify_sync_diagnostics')).toBe(false);
    expect(hasAssistantToolPrincipalAccess(principal, 'ims_marketing_performance')).toBe(false);
  });

  it('requires dynamic capabilities before advertising integration and Foresight tools', () => {
    const principal = ims('StandardUser');
    expect(isAssistantToolAvailable(principal, 'ims_xero_sync_diagnostics')).toBe(false);
    expect(isAssistantToolAvailable(principal, 'ims_xero_sync_diagnostics', { xero: true })).toBe(true);
    expect(isAssistantToolAvailable(principal, 'ims_shopify_sync_diagnostics', { shopify: false })).toBe(false);
    expect(isAssistantToolAvailable(principal, 'ims_marketing_recommendations', { 'foresight.marketing': true })).toBe(true);
  });

  it('keeps POS and wholesale operations inside their verified principal types', () => {
    const pos: AssistantPrincipal = {
      audience: 'pos', businessId: 'biz-1', posUserId: 8, locationId: 4,
      locationName: 'Main', registerId: 2, registerName: 'Front', tier: 'PosUser',
    };
    const wholesale: AssistantPrincipal = {
      audience: 'wholesale', businessId: 'biz-1', contactId: 1, companyId: 2,
      locationId: 3, memberId: 4, memberRole: 'buyer', brandAccess: { mode: 'all', brands: [] },
    };
    expect(hasAssistantToolPrincipalAccess(pos, 'pos_register_status')).toBe(true);
    expect(hasAssistantToolPrincipalAccess(pos, 'ims_product_lookup')).toBe(false);
    expect(hasAssistantToolPrincipalAccess(wholesale, 'wholesale_order_summary')).toBe(true);
    expect(hasAssistantToolPrincipalAccess(wholesale, 'pos_recent_transactions')).toBe(false);
  });
});