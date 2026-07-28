import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery, mockImsExecute } = vi.hoisted(() => ({ mockImsQuery: vi.fn(), mockImsExecute: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({
  imsExecute: mockImsExecute,
  imsQuery: mockImsQuery,
}));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: vi.fn() }));

import { listCustomerServiceThreads, updateCustomerServiceThread } from '../repository';

describe('customer-service inbox repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImsExecute.mockResolvedValue({ affectedRows: 1 });
    mockImsQuery.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
  });

  it('inlines bounded pagination instead of binding unsupported LIMIT parameters', async () => {
    await listCustomerServiceThreads('biz-1', { page: 3, pageSize: 30 });

    const [sql, params] = mockImsQuery.mock.calls[1];
    expect(sql).toContain('LIMIT 30 OFFSET 60');
    expect(sql).not.toMatch(/LIMIT \?|OFFSET \?/);
    expect(params).toEqual(['biz-1']);
  });

  it('falls back to safe pagination when values are not finite', async () => {
    const result = await listCustomerServiceThreads('biz-1', { page: Number.NaN, pageSize: Number.NaN });

    const [sql] = mockImsQuery.mock.calls[1];
    expect(sql).toContain('LIMIT 30 OFFSET 0');
    expect(result).toMatchObject({ page: 1, pageSize: 30 });
  });

  it('excludes archived threads unless status is explicitly requested', async () => {
    await listCustomerServiceThreads('biz-1', {});
    const [defaultSql] = mockImsQuery.mock.calls[1];
    expect(defaultSql).toContain("COALESCE(t.workflow_status, 'open') <> 'archived'");

    mockImsQuery.mockReset();
    mockImsQuery.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
    await listCustomerServiceThreads('biz-1', { status: 'archived' });
    const [archivedSql, archivedParams] = mockImsQuery.mock.calls[1];
    expect(archivedSql).toContain('t.workflow_status = ?');
    expect(archivedParams).toEqual(['biz-1', 'archived']);
  });

  it('orders starred threads first before date sorting', async () => {
    await listCustomerServiceThreads('biz-1', {});
    const [sql] = mockImsQuery.mock.calls[1];
    expect(sql).toContain('ORDER BY t.is_starred DESC');
    expect(sql).toContain('COALESCE(t.starred_at, t.last_message_at) DESC');
  });

  it('supports toggling thread star state', async () => {
    const updated = await updateCustomerServiceThread('biz-1', 12, { userId: 7, starred: true });
    expect(updated).toBe(true);
    const [updateSql, updateParams] = mockImsExecute.mock.calls[0];
    expect(updateSql).toContain('is_starred = ?');
    expect(updateSql).toContain('starred_at = ?');
    expect(updateParams[0]).toBe(1);
  });
});