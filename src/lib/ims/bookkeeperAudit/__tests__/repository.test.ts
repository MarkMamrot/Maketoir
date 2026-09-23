import { describe, expect, it, vi } from 'vitest';
import { acceptAuditFinding, listAcceptedAuditReviews, undoAuditFindingAcceptance } from '../repository';

function transactionDependencies(input?: { rows?: unknown[]; affectedRows?: number }) {
  const execute = vi.fn().mockResolvedValue({ affectedRows: input?.affectedRows ?? 1 });
  const transactionQuery = vi.fn().mockResolvedValue(input?.rows ?? [{ id: 9 }]);
  const transaction = vi.fn(async callback => callback({ execute, query: transactionQuery }));
  return { dependencies: { query: vi.fn() as any, transaction }, execute, transactionQuery, transaction };
}

describe('bookkeeper audit review repository', () => {
  it('lists only active reviews for the requested business', async () => {
    const query = vi.fn().mockResolvedValue([{
      id: 9, finding_key: 'stock:v1:3:negative', fingerprint: 'a'.repeat(64), reason: 'Known timing difference',
      actor_id: '7', actor_name: 'Alex', accepted_at: '2026-09-23 01:00:00.000',
    }]);
    await expect(listAcceptedAuditReviews('biz-1', { query, transaction: vi.fn() } as any)).resolves.toEqual([{
      id: 9, findingKey: 'stock:v1:3:negative', fingerprint: 'a'.repeat(64), reason: 'Known timing difference',
      actorId: '7', actorName: 'Alex', acceptedAt: '2026-09-23 01:00:00.000',
    }]);
    expect(query.mock.calls[0][1]).toEqual(['biz-1']);
    expect(String(query.mock.calls[0][0])).toContain("status = 'accepted'");
  });

  it('accepts an exact fingerprint and appends its event atomically', async () => {
    const { dependencies, execute, transactionQuery, transaction } = transactionDependencies();
    await expect(acceptAuditFinding({
      businessId: 'biz-1', findingKey: 'sales_order:42:overdue', fingerprint: 'b'.repeat(64),
      reason: 'Customer approved the revised delivery date', actorId: 7, actorName: 'Alex',
    }, dependencies as any)).resolves.toBe(9);

    expect(transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][1]).toEqual([
      'biz-1', 'sales_order:42:overdue', 'b'.repeat(64),
      'Customer approved the revised delivery date', '7', 'Alex',
    ]);
    expect(transactionQuery.mock.calls[0][1]).toEqual(['biz-1', 'sales_order:42:overdue', 'b'.repeat(64)]);
    expect(String(execute.mock.calls[1][0])).toContain("'accepted'");
  });

  it('requires a reason and a SHA-256 fingerprint', async () => {
    const { dependencies, transaction } = transactionDependencies();
    await expect(acceptAuditFinding({
      businessId: 'biz-1', findingKey: 'finding', fingerprint: 'a'.repeat(64), reason: '   ',
    }, dependencies as any)).rejects.toThrow('reason is required');
    await expect(acceptAuditFinding({
      businessId: 'biz-1', findingKey: 'finding', fingerprint: 'not-a-hash', reason: 'Reviewed',
    }, dependencies as any)).rejects.toThrow('valid audit fingerprint');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('revokes only the tenant-scoped accepted fingerprint and appends an event', async () => {
    const { dependencies, execute, transactionQuery } = transactionDependencies();
    await expect(undoAuditFindingAcceptance({
      businessId: 'biz-1', findingKey: 'sales_order:42:overdue', fingerprint: 'c'.repeat(64),
      actorId: 7, actorName: 'Alex',
    }, dependencies as any)).resolves.toBe(true);
    expect(transactionQuery.mock.calls[0][1]).toEqual(['biz-1', 'sales_order:42:overdue', 'c'.repeat(64)]);
    expect(execute.mock.calls[0][1]).toEqual(['biz-1', 9]);
    expect(String(execute.mock.calls[1][0])).toContain("'revoked'");
  });

  it('does nothing when the accepted fingerprint no longer matches', async () => {
    const { dependencies, execute } = transactionDependencies({ rows: [] });
    await expect(undoAuditFindingAcceptance({
      businessId: 'biz-1', findingKey: 'sales_order:42:overdue', fingerprint: 'd'.repeat(64),
    }, dependencies as any)).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});