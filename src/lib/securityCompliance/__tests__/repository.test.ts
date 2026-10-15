import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPolicyAssignments } from '../policies';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), query: vi.fn(), getConnection: vi.fn(),
  sql: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({
  execute: mocks.execute, query: mocks.query, getPool: () => ({ getConnection: mocks.getConnection }),
}));

describe('platform policy responsibility persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({});
    mocks.query.mockResolvedValue([]);
    mocks.getConnection.mockResolvedValue({
      execute: mocks.sql, beginTransaction: mocks.begin, commit: mocks.commit,
      rollback: mocks.rollback, release: mocks.release,
    });
    mocks.begin.mockResolvedValue(undefined);
    mocks.commit.mockResolvedValue(undefined);
    mocks.rollback.mockResolvedValue(undefined);
    mocks.sql.mockImplementation(async (sql: string) => sql.startsWith('SELECT')
      ? [[{ assignments_json: JSON.stringify(createDefaultPolicyAssignments()), revision: 1,
        updated_by: 42, updated_at: '2026-10-15T00:00:00.000Z' }], []]
      : [{ affectedRows: 1 }, []]);
  });

  it('returns unsaved defaults only when no settings row exists', async () => {
    const { getPolicyAssignments } = await import('../repository');
    expect(await getPolicyAssignments()).toEqual({
      assignments: createDefaultPolicyAssignments(), revision: 0, updatedAt: null, updatedBy: null,
    });
    expect(mocks.execute.mock.calls.every(([sql]) => sql.startsWith('CREATE TABLE'))).toBe(true);
  });

  it('loads saved responsibilities rather than substituting defaults', async () => {
    const assignments = { ...createDefaultPolicyAssignments(), privacyOwner: 'Privacy lead' };
    mocks.query.mockResolvedValue([{ assignments_json: assignments, revision: 4, updated_by: 8,
      updated_at: '2026-10-15T00:00:00.000Z' }]);
    const { getPolicyAssignments } = await import('../repository');
    expect(await getPolicyAssignments()).toMatchObject({ assignments, revision: 4, updatedBy: 8 });
  });

  it('does not disguise corrupt stored settings as valid defaults', async () => {
    mocks.query.mockResolvedValue([{ assignments_json: '{"incidentLead":42}', revision: 2 }]);
    const { getPolicyAssignments } = await import('../repository');
    await expect(getPolicyAssignments()).rejects.toThrow('Stored security policy responsibilities are invalid');
  });

  it('saves the assignment revision and attributed history in the same transaction', async () => {
    const { savePolicyAssignments } = await import('../repository');
    const assignments = createDefaultPolicyAssignments();
    const state = await savePolicyAssignments({ assignments, expectedRevision: 0, actorUserId: 42 });
    expect(state).toMatchObject({ assignments, revision: 1, updatedBy: 42 });
    expect(mocks.sql).toHaveBeenCalledWith(expect.stringContaining('WHERE id = 1 AND revision = ?'),
      [JSON.stringify(assignments), 42, 0]);
    expect(mocks.sql).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO security_policy_assignment_history'),
      [1, JSON.stringify(assignments), 42]);
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.rollback).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('rolls back a stale save without writing history', async () => {
    mocks.sql.mockResolvedValue([{ affectedRows: 0 }, []]);
    const { savePolicyAssignments, PolicyAssignmentConflictError } = await import('../repository');
    await expect(savePolicyAssignments({ assignments: createDefaultPolicyAssignments(), expectedRevision: 4, actorUserId: 42 }))
      .rejects.toBeInstanceOf(PolicyAssignmentConflictError);
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.sql.mock.calls.some(([sql]) => sql.includes('INSERT INTO security_policy_assignment_history'))).toBe(false);
  });

  it('rolls back the current settings if history fails to persist', async () => {
    mocks.sql.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO security_policy_assignment_history')) throw new Error('history unavailable');
      if (sql.startsWith('SELECT')) return [[{
        assignments_json: createDefaultPolicyAssignments(), revision: 1, updated_by: 42, updated_at: null,
      }], []];
      return [{ affectedRows: 1 }, []];
    });
    const { savePolicyAssignments } = await import('../repository');
    await expect(savePolicyAssignments({ assignments: createDefaultPolicyAssignments(), expectedRevision: 0, actorUserId: 42 }))
      .rejects.toThrow('history unavailable');
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('retries main-schema initialization after a visible failure', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('schema unavailable'));
    const { getPolicyAssignments } = await import('../repository');
    await expect(getPolicyAssignments()).rejects.toThrow('schema unavailable');
    await expect(getPolicyAssignments()).resolves.toMatchObject({ revision: 0 });
  });
});
