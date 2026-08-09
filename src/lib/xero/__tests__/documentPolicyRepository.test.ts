import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_XERO_DOCUMENT_POLICY } from '../documentPolicies';

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(), query: vi.fn(), begin: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({
  query: mocks.query,
  getPool: () => ({ getConnection: mocks.getConnection }),
}));

import { saveXeroDocumentPolicy } from '../documentPolicyRepository';

describe('saveXeroDocumentPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.begin.mockResolvedValue(undefined);
    mocks.commit.mockResolvedValue(undefined);
    mocks.rollback.mockResolvedValue(undefined);
    mocks.getConnection.mockResolvedValue({
      beginTransaction: mocks.begin, execute: mocks.execute, commit: mocks.commit,
      rollback: mocks.rollback, release: mocks.release,
    });
    mocks.execute.mockResolvedValueOnce([[]]).mockResolvedValue([{ affectedRows: 1 }]);
  });

  it('atomically upserts a change and appends actor, preset, before, after, and diff', async () => {
    const policy = { ...DEFAULT_XERO_DOCUMENT_POLICY, poApprovedAction: 'authorised' as const };
    const result = await saveXeroDocumentPolicy({
      businessId: 'biz-1', policy, actorId: 7, actorName: 'Alex', presetSource: 'higher_automation',
    });

    expect(result.changedFields).toEqual([{ field: 'poApprovedAction', before: 'draft', after: 'authorised' }]);
    expect(mocks.begin).toHaveBeenCalledOnce();
    expect(String(mocks.execute.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(String(mocks.execute.mock.calls[2][0])).toContain('xero_document_policy_events');
    expect(mocks.execute.mock.calls[2][1].slice(0, 4)).toEqual(['biz-1', '7', 'Alex', 'higher_automation']);
    expect(JSON.parse(mocks.execute.mock.calls[2][1][4])).toEqual(DEFAULT_XERO_DOCUMENT_POLICY);
    expect(JSON.parse(mocks.execute.mock.calls[2][1][5])).toEqual(policy);
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('does not write an event for a no-op save', async () => {
    const result = await saveXeroDocumentPolicy({ businessId: 'biz-1', policy: DEFAULT_XERO_DOCUMENT_POLICY });
    expect(result.changedFields).toEqual([]);
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('rolls back when event persistence fails', async () => {
    mocks.execute.mockReset();
    mocks.execute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockRejectedValueOnce(new Error('event insert failed'));
    await expect(saveXeroDocumentPolicy({
      businessId: 'biz-1', policy: { ...DEFAULT_XERO_DOCUMENT_POLICY, soApprovedAction: 'authorised' },
    })).rejects.toThrow('event insert failed');
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});