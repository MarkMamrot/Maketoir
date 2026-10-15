import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import guards from '../../../../scripts/platform-security-guards.json';
import { createDefaultPolicyAssignments, SECURITY_POLICIES } from '../policies';
import { validatePolicyEvidenceRequest } from '../policyEvidence';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), native: vi.fn(), query: vi.fn(), sql: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({
  execute: mocks.execute, query: mocks.query, getPool: () => ({ query: mocks.native, getConnection: async () => ({
    execute: mocks.sql, beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release,
  }) }),
}));

const fingerprint = (id = 'incident-response') => createHash('sha256')
  .update(JSON.stringify(SECURITY_POLICIES.find(policy => policy.id === id))).digest('hex');
const request = () => validatePolicyEvidenceRequest({
  policyId: 'incident-response', kind: 'adoption', expectedRevision: 3, policyHash: fingerprint(),
  operationKey: 'c042862d-870e-45c5-a293-57f2ed3f6ef0', summary: 'Authorised current policy',
  evidenceReference: 'Restricted review register', reviewFrom: null, reviewThrough: null, acknowledged: true,
});
const assignments = () => ({ assignments_json: createDefaultPolicyAssignments(), revision: 3, updated_by: 42, updated_at: null });
const evidence = () => ({
  id: 7, policy_id: 'incident-response', event_kind: 'adoption', policy_version: '1.0', policy_hash: fingerprint(),
  assignment_revision: 3, actor_user_id: 42, summary: 'Authorised current policy', evidence_reference: 'Restricted review register',
  recorded_at: '2026-10-15T12:00:00.000Z', review_from: null, review_through: null,
  operation_key: request().operationKey, request_hash: createHash('sha256').update(JSON.stringify({ request: request(), actorUserId: 42 })).digest('hex'),
});
const installed = () => guards.filter(guard => guard.table === 'security_policy_evidence')
  .map(guard => ({
    TRIGGER_NAME: guard.name, ACTION_STATEMENT: guard.body, ACTION_TIMING: 'BEFORE',
    EVENT_MANIPULATION: guard.event, EVENT_OBJECT_TABLE: guard.table,
  }));

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  mocks.execute.mockResolvedValue({});
  mocks.native.mockResolvedValue({});
  mocks.query.mockImplementation(async (sql: string) => sql.includes('information_schema.TRIGGERS') ? installed() : []);
  mocks.sql.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM security_policy_assignments')) return [[assignments()]];
    if (sql.includes('WHERE operation_key')) return [[]];
    if (sql.includes("event_kind = 'adoption'")) return [[]];
    if (sql.includes('WHERE id = ?')) return [[evidence()]];
    return [{ affectedRows: 1, insertId: 7 }];
  });
});

describe('append-only policy evidence', () => {
  it('locks saved responsibilities and snapshots names, policy text and verified actor in one transaction', async () => {
    const { savePolicyEvidence } = await import('../repository');
    expect(await savePolicyEvidence({ request: request(), actorUserId: 42 })).toMatchObject({ id: 7, actorUserId: 42, assignmentRevision: 3 });
    expect(mocks.sql).toHaveBeenCalledWith(expect.stringContaining('WHERE id = 1 FOR UPDATE'));
    const insert = mocks.sql.mock.calls.find(([sql]) => sql.includes('INSERT INTO security_policy_evidence'))!;
    expect(insert[1].slice(0, 7)).toEqual(['incident-response', 'adoption', '1.0', fingerprint(), 3, JSON.stringify(createDefaultPolicyAssignments()), 42]);
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.rollback).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it.each(['revision', 'hash'])('rolls back stale %s evidence', async field => {
    const { savePolicyEvidence, PolicyEvidenceConflictError } = await import('../repository');
    const stale = { ...request(), ...(field === 'revision' ? { expectedRevision: 2 } : { policyHash: 'a'.repeat(64) }) };
    await expect(savePolicyEvidence({ request: stale, actorUserId: 42 })).rejects.toBeInstanceOf(PolicyEvidenceConflictError);
    expect(mocks.sql.mock.calls.some(([sql]) => sql.includes('INSERT INTO security_policy_evidence'))).toBe(false);
    expect(mocks.rollback).toHaveBeenCalledOnce(); expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('returns an identical retry without appending another record', async () => {
    mocks.sql.mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT IGNORE')) return [{ affectedRows: 0 }];
      if (sql.includes('FROM security_policy_assignments')) return [[assignments()]];
      if (sql.includes('WHERE operation_key')) return [[evidence()]];
      throw new Error('An idempotent retry must not write evidence');
    });
    const { savePolicyEvidence } = await import('../repository');
    expect(await savePolicyEvidence({ request: request(), actorUserId: 42 })).toMatchObject({ id: 7 });
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it.each(['actor', 'content'])('rejects operation-key reuse by different %s', async field => {
    mocks.sql.mockImplementation(async (sql: string) => sql.includes('FROM security_policy_assignments')
      ? [[assignments()]] : [[{ ...evidence(), ...(field === 'actor' ? { actor_user_id: 99 } : { request_hash: 'b'.repeat(64) }) }]]);
    const { savePolicyEvidence, PolicyEvidenceConflictError } = await import('../repository');
    await expect(savePolicyEvidence({ request: request(), actorUserId: 42 })).rejects.toBeInstanceOf(PolicyEvidenceConflictError);
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });

  it('requires current-text adoption before a periodic review', async () => {
    const { savePolicyEvidence, PolicyEvidenceConflictError } = await import('../repository');
    await expect(savePolicyEvidence({ request: { ...request(), kind: 'policy_review' }, actorUserId: 42 }))
      .rejects.toBeInstanceOf(PolicyEvidenceConflictError);
    expect(mocks.commit).not.toHaveBeenCalled(); expect(mocks.rollback).toHaveBeenCalledOnce();
  });

  it('does not commit an insert that cannot be read back', async () => {
    mocks.sql.mockImplementation(async (sql: string) => sql.includes('FROM security_policy_assignments')
      ? [[assignments()]] : sql.startsWith('SELECT') ? [[]] : [{ affectedRows: 1, insertId: 7 }]);
    const { savePolicyEvidence } = await import('../repository');
    await expect(savePolicyEvidence({ request: request(), actorUserId: 42 })).rejects.toThrow('could not be verified');
    expect(mocks.commit).not.toHaveBeenCalled(); expect(mocks.rollback).toHaveBeenCalledOnce(); expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('shows adoption only for current policy fingerprints, separately from limited history', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.TRIGGERS')) return installed();
      if (sql.includes('WHERE id IN')) return [evidence()];
      return [];
    });
    const { getPolicyEvidence } = await import('../repository');
    const state = await getPolicyEvidence();
    expect(state.history).toEqual([]);
    expect(state.policies.find(policy => policy.id === 'incident-response')).toMatchObject({
      adoptedAt: '2026-10-15T12:00:00.000Z', nextReviewAt: '2027-04-15T12:00:00.000Z',
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE policy_hash IN'), expect.arrayContaining([fingerprint()]));
  });
});

describe('audit write guards', () => {
  it('uses native SQL rather than prepared statements to create MySQL triggers', async () => {
    mocks.query.mockResolvedValue([]);
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith('CREATE TRIGGER')) throw new Error('Unsupported prepared statement');
      return {};
    });
    const { getPolicyEvidence } = await import('../repository');
    await expect(getPolicyEvidence()).resolves.toMatchObject({ history: [] });
    expect(mocks.native).toHaveBeenCalledTimes(2);
    expect(mocks.native.mock.calls.every(([sql]) => sql.startsWith('CREATE TRIGGER'))).toBe(true);
  });

  it('fails visibly when a canonical evidence guard differs', async () => {
    mocks.query.mockResolvedValue([{ ...installed()[0], ACTION_STATEMENT: 'BEGIN END' }]);
    const { getPolicyEvidence } = await import('../repository');
    await expect(getPolicyEvidence()).rejects.toThrow('write guard differs');
  });

  it.each([
    { ACTION_TIMING: 'AFTER' }, { EVENT_MANIPULATION: 'INSERT' }, { EVENT_OBJECT_TABLE: 'another_table' },
  ])('rejects a correctly named guard attached to the wrong operation or table', async metadata => {
    mocks.query.mockResolvedValue([{ ...installed()[0], ...metadata }]);
    const { getPolicyEvidence } = await import('../repository');
    await expect(getPolicyEvidence()).rejects.toThrow('write guard differs');
  });

  it('accepts concurrent creation only after verifying the exact canonical body', async () => {
    mocks.query.mockImplementation(async (sql: string, params?: string[]) => {
      if (sql.includes('TRIGGER_NAME = ?')) return installed().filter(guard => guard.TRIGGER_NAME === params?.[0]);
      return [];
    });
    mocks.native.mockImplementation(async (sql: string) => {
      if (sql.startsWith('CREATE TRIGGER')) throw Object.assign(new Error('concurrent trigger'), { code: 'ER_TRG_ALREADY_EXISTS' });
      return {};
    });
    const { getPolicyEvidence } = await import('../repository');
    await expect(getPolicyEvidence()).resolves.toMatchObject({ history: [] });
    expect(mocks.query.mock.calls.filter(([sql]) => sql.includes('TRIGGER_NAME = ?'))).toHaveLength(2);
  });
});

describe('platform authentication review pagination', () => {
  const row = (id: number) => ({
    id, user_id: null, actor_user_id: null, business_id: null, event_type: 'login_failure',
    ip_address: null, city: null, region: null, country: null, user_agent: null,
    created_at: '2026-10-15T12:00:00Z', matched_count: 300,
  });

  it('returns 250 entries with a lookahead and a count covering the whole period', async () => {
    mocks.query.mockResolvedValue(Array.from({ length: 251 }, (_, index) => row(300 - index)));
    const { getAuthenticationReviewData } = await import('../repository');
    const result = await getAuthenticationReviewData({ from: '2026-10-01', through: '2026-10-15', beforeId: 301 });
    expect(result).toMatchObject({ totalCount: 300, hasMore: true });
    expect(result.entries).toHaveLength(250);
    expect(result.entries[0]).toMatchObject({ id: 300, userId: null, location: '' });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('COUNT(*) OVER()'), ['2026-10-01', '2026-10-15', 301, 301]);
  });

  it('preserves the total period count on an empty last page', async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ matched_count: 300 }]);
    const { getAuthenticationReviewData } = await import('../repository');
    expect(await getAuthenticationReviewData({ from: '2026-10-01', through: '2026-10-15', beforeId: 1 }))
      .toEqual({ totalCount: 300, hasMore: false, entries: [] });
  });

  it.each([0, -1, 1.5, NaN])('rejects an invalid cursor before querying: %s', async beforeId => {
    const { getAuthenticationReviewData } = await import('../repository');
    await expect(getAuthenticationReviewData({ from: '2026-10-01', through: '2026-10-15', beforeId })).rejects.toThrow('valid page');
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects periods longer than 366 inclusive UTC dates', async () => {
    const { getAuthenticationReviewData } = await import('../repository');
    await expect(getAuthenticationReviewData({ from: '2024-01-01', through: '2025-01-01' })).rejects.toThrow('Limit authentication');
  });
});
