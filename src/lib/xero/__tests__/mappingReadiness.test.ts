import { describe, expect, it } from 'vitest';

import { DEFAULT_XERO_DOCUMENT_POLICY } from '../documentPolicies';
import { evaluateXeroMappingReadiness, summarizeXeroMappingReadiness, type MappingReadinessInput } from '../mappingReadiness';

function input(overrides: Partial<MappingReadinessInput> = {}): MappingReadinessInput {
  return {
    policy: DEFAULT_XERO_DOCUMENT_POLICY,
    accounts: [
      { accountId: 'sales', code: '200', status: 'ACTIVE', type: 'REVENUE' },
      { accountId: 'bank', code: '090', status: 'ACTIVE', type: 'BANK' },
    ],
    accountMappings: [{ roleKey: 'sales_revenue', accountId: 'sales', accountCode: '200' }],
    paymentMethods: [], posClearing: [], gateways: [], tracking: [], ...overrides,
  };
}

describe('evaluateXeroMappingReadiness', () => {
  it('makes payment methods required only when their policy switch is enabled', () => {
    const base = input({ paymentMethods: [{ side: 'po', id: 1, name: 'EFT', active: true, accountCode: null }] });
    expect(evaluateXeroMappingReadiness(base).find(item => item.key === 'po:1')).toMatchObject({ requirement: 'required', status: 'missing' });
    const disabled = { ...base, policy: { ...base.policy, poPaymentSyncEnabled: false } };
    expect(evaluateXeroMappingReadiness(disabled).find(item => item.key === 'po:1')).toMatchObject({ requirement: 'optional', status: 'optional' });
  });

  it('reports stale saved mappings even when their feature is optional', () => {
    const items = evaluateXeroMappingReadiness(input({
      accountMappings: [{ roleKey: 'credit_note', accountId: 'archived', accountCode: '201' }],
    }));
    expect(items.find(item => item.key === 'credit_note')).toMatchObject({ requirement: 'optional', status: 'stale' });
  });

  it('marks missing POS clearing as actionable without claiming EOD closure is blocked', () => {
    const items = evaluateXeroMappingReadiness(input({
      posClearing: [{ locationId: 4, locationName: 'City', paymentMethod: 'Card', accountId: null, accountCode: null }],
    }));
    const item = items.find(candidate => candidate.category === 'pos_clearing')!;
    expect(item).toMatchObject({ requirement: 'required', status: 'missing' });
    expect(item.summary).toContain('POS EOD closure is not blocked');
  });

  it('allows Draft online invoices with required gateway payment readiness', () => {
    const report = evaluateXeroMappingReadiness(input({
      policy: { ...DEFAULT_XERO_DOCUMENT_POLICY, onlineBatchAction: 'draft', onlineBatchPaymentSyncEnabled: true },
      gateways: [{ gatewayName: 'paypal', displayName: 'PayPal', accountCode: '090' }],
    }));
    expect(report.find(item => item.key === 'paypal')).toMatchObject({ requirement: 'required', status: 'ready' });
  });

  it('summarizes required readiness separately from stale optional mappings', () => {
    const summary = summarizeXeroMappingReadiness(evaluateXeroMappingReadiness(input({
      policy: { ...DEFAULT_XERO_DOCUMENT_POLICY, poApprovedAction: 'none', poCompletedAction: 'none', poPaymentSyncEnabled: false },
    })));
    expect(summary.required).toBeGreaterThan(0);
    expect(summary.missing).toBeGreaterThanOrEqual(0);
    expect(summary.ready).toBeLessThanOrEqual(summary.required);
  });
});