import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_XERO_DOCUMENT_POLICY } from '../documentPolicies';

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(), query: vi.fn(), begin: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({
  query: mocks.query,
  getPool: () => ({ getConnection: mocks.getConnection }),
}));

import { ensureInitialXeroDocumentPolicy, getXeroDocumentPolicy, saveXeroDocumentPolicy } from '../documentPolicyRepository';

describe('saveXeroDocumentPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReset().mockResolvedValue([{ configured: 1 }]);
    mocks.begin.mockResolvedValue(undefined);
    mocks.commit.mockResolvedValue(undefined);
    mocks.rollback.mockResolvedValue(undefined);
    mocks.getConnection.mockResolvedValue({
      beginTransaction: mocks.begin, execute: mocks.execute, commit: mocks.commit,
      rollback: mocks.rollback, release: mocks.release,
    });
    mocks.execute.mockReset().mockResolvedValueOnce([[]]).mockResolvedValue([{ affectedRows: 1 }]);
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
    expect(mocks.execute.mock.calls[1][1][1]).toBe(1);
    expect(mocks.execute.mock.calls[1][1]).toHaveLength(23);
    expect(String(mocks.execute.mock.calls[1][0])).toContain('shopify_payout_posting_enabled');
    expect(String(mocks.execute.mock.calls[1][0])).toContain('stocktake_journal_enabled');
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

  it('starts an unconfigured business paused, even with failed historical attempts', async () => {
    mocks.query.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ present: 1 }]).mockResolvedValueOnce([]);
    expect(await getXeroDocumentPolicy('new-business')).toEqual({ ...DEFAULT_XERO_DOCUMENT_POLICY, postingEnabled: false });
    expect(mocks.query.mock.calls[3][0]).toContain("status = 'success'");
    expect(mocks.query.mock.calls[3][1]).toEqual(['new-business']);
  });

  it('starts paused when the optional historical log does not exist', async () => {
    mocks.query.mockReset().mockResolvedValue([]);
    expect((await getXeroDocumentPolicy('new-business')).postingEnabled).toBe(false);
    expect(mocks.query).toHaveBeenCalledTimes(3);
  });

  it('preserves the effective defaults of a configured legacy business', async () => {
    mocks.query.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ configured: 1 }]);
    expect(await getXeroDocumentPolicy('legacy-business')).toEqual(DEFAULT_XERO_DOCUMENT_POLICY);
  });

  it('preserves legacy posting intent after disconnection', async () => {
    mocks.query.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ present: 1 }]).mockResolvedValueOnce([{ posted: 1 }]);
    expect((await getXeroDocumentPolicy('disconnected-business')).postingEnabled).toBe(true);
  });

  it.each([0, 1])('never replaces a saved posting choice of %s with connection defaults', async posting => {
    mocks.query.mockReset().mockResolvedValueOnce([{ posting_enabled: posting, stocktake_journal_enabled: 0 }]);
    expect(await getXeroDocumentPolicy('saved-business')).toMatchObject({ postingEnabled: Boolean(posting), stocktakeJournalEnabled: false });
    expect(mocks.query).toHaveBeenCalledOnce();
  });

  it('audits a first opt-in against the same paused default shown by GET', async () => {
    mocks.query.mockReset().mockResolvedValue([]);
    const result = await saveXeroDocumentPolicy({ businessId: 'new-business', policy: DEFAULT_XERO_DOCUMENT_POLICY });
    expect(result.changedFields).toEqual([{ field: 'postingEnabled', before: false, after: true }]);
    expect(JSON.parse(mocks.execute.mock.calls[2][1][4]).postingEnabled).toBe(false);
  });

  it.each([0, 1])('initialising a connection preserves a saved master choice of %s', async posting => {
    mocks.query.mockReset().mockResolvedValueOnce([{ posting_enabled: posting }]).mockResolvedValueOnce([]);
    await ensureInitialXeroDocumentPolicy('saved-business');
    expect(mocks.query.mock.calls[1][0]).toContain('INSERT IGNORE');
    expect(mocks.query.mock.calls[1][1]).toEqual(['saved-business', posting]);
  });

  it('does not pause a disconnected legacy integration when reconnecting', async () => {
    mocks.query.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ present: 1 }]).mockResolvedValueOnce([{ posted: 1 }]).mockResolvedValueOnce([]);
    await ensureInitialXeroDocumentPolicy('legacy-business');
    expect(mocks.query.mock.calls[4][1]).toEqual(['legacy-business', 1]);
  });

  it('initialises a genuinely new connection with posting paused', async () => {
    mocks.query.mockReset().mockResolvedValue([]);
    await ensureInitialXeroDocumentPolicy('new-business');
    expect(mocks.query.mock.calls[3][1]).toEqual(['new-business', 0]);
  });
});