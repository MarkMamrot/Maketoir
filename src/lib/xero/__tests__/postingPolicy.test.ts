import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_XERO_DOCUMENT_POLICY } from '../documentPolicies';
import {
  assertXeroPostingEnabled,
  assertXeroWorkflowEnabled,
  XeroPostingDisabledError,
  XeroWorkflowDisabledError,
} from '../postingPolicy';
import { XeroAccountingDisabledError } from '@/lib/ims/businessOperations';

const mocks = vi.hoisted(() => ({
  assertAccountingEnabled: vi.fn(),
  getPolicy: vi.fn(),
}));

vi.mock('@/lib/ims/businessOperations', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ims/businessOperations')>(),
  assertXeroAccountingEnabled: mocks.assertAccountingEnabled,
}));

vi.mock('../documentPolicyRepository', () => ({
  getXeroDocumentPolicy: mocks.getPolicy,
}));

describe('Xero workflow posting policy', () => {
  beforeEach(() => {
    mocks.assertAccountingEnabled.mockReset();
    mocks.assertAccountingEnabled.mockResolvedValue(undefined);
    mocks.getPolicy.mockReset();
    mocks.getPolicy.mockResolvedValue({ ...DEFAULT_XERO_DOCUMENT_POLICY });
  });

  it('allows an enabled workflow', async () => {
    await expect(assertXeroWorkflowEnabled('biz-1', 'stocktakeJournalEnabled')).resolves.toMatchObject({
      postingEnabled: true,
      stocktakeJournalEnabled: true,
    });
  });

  it('checks the accounting switch before loading posting policy', async () => {
    mocks.assertAccountingEnabled.mockRejectedValueOnce(new XeroAccountingDisabledError());

    await expect(assertXeroPostingEnabled('biz-1')).rejects.toBeInstanceOf(XeroAccountingDisabledError);
    expect(mocks.getPolicy).not.toHaveBeenCalled();
  });

  it('reports the master pause before the workflow switch', async () => {
    mocks.getPolicy.mockResolvedValue({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      postingEnabled: false,
      stocktakeJournalEnabled: false,
    });

    await expect(assertXeroWorkflowEnabled('biz-1', 'stocktakeJournalEnabled'))
      .rejects.toBeInstanceOf(XeroPostingDisabledError);
  });

  it('identifies the disabled workflow with a stable error', async () => {
    mocks.getPolicy.mockResolvedValue({
      ...DEFAULT_XERO_DOCUMENT_POLICY,
      stocktakeJournalEnabled: false,
    });

    const error = await assertXeroWorkflowEnabled('biz-1', 'stocktakeJournalEnabled').catch(value => value);
    expect(error).toBeInstanceOf(XeroWorkflowDisabledError);
    expect(error).toMatchObject({ code: 'xero_workflow_disabled', status: 423, workflow: 'stocktakeJournalEnabled' });
    expect(error.message).toContain('Stocktake journals');
  });
});