import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({
  imsExecute: vi.fn(),
  imsQuery: mockImsQuery,
}));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: vi.fn() }));

import { listCustomerServiceThreads } from '../repository';

describe('customer-service inbox repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});