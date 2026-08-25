import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetConnection, mockImsQuery, mockImsExecute } = vi.hoisted(() => ({
  mockGetConnection: vi.fn(), mockImsQuery: vi.fn(), mockImsExecute: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  imsExecute: mockImsExecute,
  imsQuery: mockImsQuery,
}));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: vi.fn() }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: mockGetConnection },
}));

import { createCustomerServiceManualDraft, getCustomerServiceThread, listCustomerServiceThreads, updateCustomerServiceThread } from '../repository';

describe('customer-service inbox repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConnection.mockResolvedValue({ gmail_email: 'shop@example.com' });
    mockImsExecute.mockResolvedValue({ affectedRows: 1 });
    mockImsQuery.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
  });

  it('inlines bounded pagination instead of binding unsupported LIMIT parameters', async () => {
    await listCustomerServiceThreads('biz-1', { page: 3, pageSize: 30 });

    const [sql, params] = mockImsQuery.mock.calls[1];
    expect(sql).toContain('LIMIT 30 OFFSET 60');
    expect(sql).not.toMatch(/LIMIT \?|OFFSET \?/);
    expect(params).toEqual(['biz-1']);
    expect(mockImsQuery.mock.calls[0][1]).toEqual(['biz-1', 'biz-1']);
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
    expect(sql).toContain("CASE WHEN t.category = 'customer_enquiry' THEN 0 ELSE 1 END");
    expect(sql).toContain('t.last_message_at DESC');
  });

  it('does not add a category predicate to the default all-mail view', async () => {
    await listCustomerServiceThreads('biz-1', {});
    const [sql, params] = mockImsQuery.mock.calls[1];
    expect(sql).not.toContain('t.category = ?');
    expect(params).toEqual(['biz-1']);
  });

  it('returns the latest tenant Gmail refresh time independently of pagination', async () => {
    mockImsQuery.mockReset();
    mockImsQuery.mockResolvedValueOnce([{ total: 25, refreshed_at: '2026-08-25 08:27:48' }]).mockResolvedValueOnce([]);

    const result = await listCustomerServiceThreads('biz-1', {});

    expect(result.refreshedAt).toBe('2026-08-25 08:27:48');
    expect(mockImsQuery.mock.calls[0][0]).toContain('MAX(last_gmail_sync_at)');
    expect(mockImsQuery.mock.calls[0][1]).toEqual(['biz-1', 'biz-1']);
  });

  it('supports toggling thread star state', async () => {
    const updated = await updateCustomerServiceThread('biz-1', 12, { userId: 7, starred: true });
    expect(updated).toBe(true);
    const [updateSql, updateParams] = mockImsExecute.mock.calls[0];
    expect(updateSql).toContain('is_starred = ?');
    expect(updateSql).toContain('starred_at = ?');
    expect(updateParams[0]).toBe(1);
  });

  it('loads bounded other conversations for the same customer within the tenant', async () => {
    mockImsQuery.mockReset();
    mockImsQuery
      .mockResolvedValueOnce([{ id: 12, customer_email: 'Customer@Example.com' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await getCustomerServiceThread('biz-1', 12);

    expect(result?.otherConversations).toEqual([]);
    const [sql, params] = mockImsQuery.mock.calls[4];
    expect(sql).toContain('LOWER(customer_email) = LOWER(?)');
    expect(sql).toContain('id <> ?');
    expect(sql).toContain('LIMIT 10');
    expect(params).toEqual(['biz-1', 'Customer@Example.com', 12]);
  });

  it('creates a forward draft for a validated explicit recipient', async () => {
    mockImsQuery.mockReset();
    mockImsQuery.mockResolvedValueOnce([{ customer_email: 'customer@example.com' }]).mockResolvedValueOnce([{ id: 73 }]);

    await expect(createCustomerServiceManualDraft({
      businessId: 'biz-1', threadId: 12, targetMessageId: 44, composeType: 'forward',
      recipientEmail: 'Manager@Example.com', ccRecipients: 'team@example.com, shop@example.com, TEAM@example.com',
      subject: 'Fwd: Order update', body: 'For your information',
      operationKey: 'manual-operation-12345', userId: 7,
    })).resolves.toEqual({ draftId: 73 });

    const [targetSql, targetParams] = mockImsQuery.mock.calls[0];
    expect(targetSql).toContain('m.business_id = ? AND m.thread_id = ? AND m.id = ?');
    expect(targetParams).toEqual(['biz-1', 12, 44]);
    const [insertSql, insertParams] = mockImsExecute.mock.calls[0];
    expect(insertSql).toContain('compose_type, recipient_email');
    expect(insertParams).toContain('manager@example.com');
    expect(insertParams).toContain('["team@example.com"]');
  });

  it('rejects a forward without a valid recipient before creating a draft', async () => {
    mockImsQuery.mockReset();
    mockImsQuery.mockResolvedValueOnce([{ customer_email: 'customer@example.com' }]);

    await expect(createCustomerServiceManualDraft({
      businessId: 'biz-1', threadId: 12, targetMessageId: 44, composeType: 'forward',
      recipientEmail: 'not-an-email', subject: 'Fwd: Order update', body: 'For your information',
      operationKey: 'manual-operation-12345', userId: 7,
    })).rejects.toThrow('Enter a valid forwarding email address');
    expect(mockImsExecute).not.toHaveBeenCalled();
  });
});