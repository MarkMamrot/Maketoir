import { describe, expect, it } from 'vitest';
import {
  DEFAULT_XERO_DOCUMENT_POLICY,
  parseXeroDocumentPolicy,
  resolvePODocumentAction,
  resolveSODocumentAction,
  validateXeroDocumentPolicy,
} from '../documentPolicies';

describe('Xero document policies', () => {
  it('preserves the existing PO and SO lifecycle defaults', () => {
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

  it('requires an Authorised online invoice for immediate clearing payments', () => {
    expect(validateXeroDocumentPolicy({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      onlineBatchAction: 'draft',
    })).toContain('Online clearing payments require');
    expect(validateXeroDocumentPolicy({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      onlineBatchAction: 'draft',
      onlineBatchPaymentSyncEnabled: false,
      shopifyPayoutAutoPostEnabled: true,
    })).toBeNull();
  });
});