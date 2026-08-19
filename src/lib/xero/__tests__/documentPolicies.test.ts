import { describe, expect, it } from 'vitest';
import {
  DEFAULT_XERO_DOCUMENT_POLICY,
  XERO_DOCUMENT_POLICY_PRESETS,
  diffXeroDocumentPolicy,
  getXeroDocumentPolicyPreset,
  getXeroDocumentPolicyWarnings,
  parseXeroDocumentPolicy,
  resolvePODocumentAction,
  resolveSODocumentAction,
  validateXeroDocumentPolicy,
} from '../documentPolicies';

describe('Xero document policies', () => {
  it('preserves the existing PO and SO lifecycle defaults', () => {
    expect(DEFAULT_XERO_DOCUMENT_POLICY.postingEnabled).toBe(true);
    expect(resolvePODocumentAction(DEFAULT_XERO_DOCUMENT_POLICY, 'confirmed')).toBe('draft');
    expect(resolvePODocumentAction(DEFAULT_XERO_DOCUMENT_POLICY, 'complete')).toBe('authorised');
    expect(resolveSODocumentAction(DEFAULT_XERO_DOCUMENT_POLICY, 'confirmed')).toBe('draft');
    expect(resolveSODocumentAction(DEFAULT_XERO_DOCUMENT_POLICY, 'fulfilled')).toBe('authorised');
    expect(DEFAULT_XERO_DOCUMENT_POLICY.poPaymentSyncEnabled).toBe(true);
    expect(DEFAULT_XERO_DOCUMENT_POLICY.soPaymentSyncEnabled).toBe(true);
    expect(DEFAULT_XERO_DOCUMENT_POLICY.manualCustomerCreditNoteAction).toBe('authorised');
    expect(DEFAULT_XERO_DOCUMENT_POLICY.supplierCreditNoteAction).toBe('draft');
    expect(DEFAULT_XERO_DOCUMENT_POLICY.posBatchSyncEnabled).toBe(true);
    expect(DEFAULT_XERO_DOCUMENT_POLICY.onlineBatchAction).toBe('authorised');
    expect(DEFAULT_XERO_DOCUMENT_POLICY.shopifyPayoutAutoPostEnabled).toBe(false);
    expect(DEFAULT_XERO_DOCUMENT_POLICY).toMatchObject({
      poReceiptJournalEnabled: true,
      shopifyRefundCreditNoteEnabled: true,
      shopifyPayoutPostingEnabled: true,
      posCashBankingEnabled: true,
      stocktakeJournalEnabled: true,
      giftCardAccountingEnabled: true,
      storeCreditAccountingEnabled: true,
    });
  });

  it('allows a later no-sync action because it leaves the Xero document unchanged', () => {
    expect(validateXeroDocumentPolicy({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      poApprovedAction: 'authorised',
      poCompletedAction: 'none',
    })).toBeNull();
  });

  it('rejects an actual document-state regression', () => {
    expect(validateXeroDocumentPolicy({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      soApprovedAction: 'authorised',
      soCompletedAction: 'draft',
    })).toContain('cannot move a Xero document backwards');
  });

  it('strictly parses actions and payment toggles', () => {
    expect(() => parseXeroDocumentPolicy({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      postingEnabled: 'yes',
    })).toThrow('postingEnabled must be a boolean');
    expect(() => parseXeroDocumentPolicy({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      poPaymentSyncEnabled: 'yes',
    })).toThrow('poPaymentSyncEnabled must be a boolean');
    expect(() => parseXeroDocumentPolicy({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      soCompletedAction: 'paid',
    })).toThrow('soCompletedAction must be none, draft, or authorised');
  });

  it('keeps IMS draft and cancelled statuses local-only', () => {
    expect(resolvePODocumentAction(DEFAULT_XERO_DOCUMENT_POLICY, 'draft')).toBe('none');
    expect(resolveSODocumentAction(DEFAULT_XERO_DOCUMENT_POLICY, 'cancelled')).toBe('none');
  });

  it('requires POS invoice sync when POS clearing payments are enabled', () => {
    expect(validateXeroDocumentPolicy({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      posBatchSyncEnabled: false,
    })).toContain('POS clearing payments require');
  });

  it('allows Draft online invoices because payment sync authorises before posting and returns a warning', () => {
    const policy = {
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      onlineBatchAction: 'draft',
    } as const;
    expect(validateXeroDocumentPolicy(policy)).toBeNull();
    expect(getXeroDocumentPolicyWarnings(policy)).toContain('Online clearing payments will authorise the daily online invoice before applying payment.');
    expect(validateXeroDocumentPolicy({ ...policy, onlineBatchAction: 'none' })).toContain('require daily online invoice sync');
  });

  it('requires the complete Shopify accounting workflow before automatic payout posting', () => {
    const automatic = { ...DEFAULT_XERO_DOCUMENT_POLICY, shopifyPayoutAutoPostEnabled: true };
    expect(validateXeroDocumentPolicy(automatic)).toBeNull();
    expect(validateXeroDocumentPolicy({ ...automatic, shopifyPayoutPostingEnabled: false })).toContain('requires Shopify payout posting');
    expect(validateXeroDocumentPolicy({ ...automatic, onlineBatchAction: 'none', onlineBatchPaymentSyncEnabled: false })).toContain('requires daily online invoice');
    expect(validateXeroDocumentPolicy({ ...automatic, shopifyRefundCreditNoteEnabled: false })).toContain('requires Shopify refund credit notes');
  });

  it('exposes valid transparent presets without storing a mode', () => {
    expect(Object.keys(XERO_DOCUMENT_POLICY_PRESETS)).toEqual(['bookkeeper_review', 'balanced_automation', 'higher_automation']);
    expect(getXeroDocumentPolicyPreset('balanced_automation')).toEqual(DEFAULT_XERO_DOCUMENT_POLICY);
    expect(getXeroDocumentPolicyPreset('bookkeeper_review')).toMatchObject({
      poCompletedAction: 'draft', soCompletedAction: 'draft', poPaymentSyncEnabled: false,
      soPaymentSyncEnabled: false, onlineBatchPaymentSyncEnabled: false,
    });
    for (const preset of Object.values(XERO_DOCUMENT_POLICY_PRESETS)) {
      expect(validateXeroDocumentPolicy(preset.policy)).toBeNull();
    }
  });

  it('returns exact field-level preset differences', () => {
    expect(diffXeroDocumentPolicy(DEFAULT_XERO_DOCUMENT_POLICY, getXeroDocumentPolicyPreset('higher_automation'))).toEqual([
      { field: 'poApprovedAction', before: 'draft', after: 'authorised' },
      { field: 'soApprovedAction', before: 'draft', after: 'authorised' },
      { field: 'supplierCreditNoteAction', before: 'draft', after: 'authorised' },
    ]);
  });
});