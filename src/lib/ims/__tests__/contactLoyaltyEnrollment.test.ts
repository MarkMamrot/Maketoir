import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery, mockImsExecute } = vi.hoisted(() => ({
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(),
  imsQuery: mockImsQuery,
  imsExecute: mockImsExecute,
}));

import { ImsContactsRepo } from '@/lib/ims/ImsRepository';

describe('contact loyalty enrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImsExecute.mockResolvedValue({ insertId: 12, affectedRows: 1 });
  });

  it('creates customers opted out by default with aligned SQL parameters', async () => {
    await ImsContactsRepo.create({
      type: 'retail_customer',
      name: 'Test Customer',
      customer_code: 'C-TEST',
      is_active: 1,
    }, 'business-1');

    const [sql, params] = mockImsExecute.mock.calls[0];
    expect((String(sql).match(/\?/g) ?? []).length).toBe(params.length);
    expect(sql).toContain('loyalty_member,loyalty_member_enrolled_at,loyalty_member_opted_out_at');
    expect(params[27]).toBe(0);
    expect(params[28]).toBe(0);
  });

  it('records the first enrollment timestamp when a customer opts in', async () => {
    mockImsQuery.mockResolvedValue([{ type: 'retail_customer', loyalty_member: 0 }]);

    await ImsContactsRepo.update(42, { loyalty_member: 1 });

    const [sql, params] = mockImsExecute.mock.calls[0];
    expect(sql).toContain('loyalty_member_enrolled_at = IF(loyalty_member = 0 AND ? = 1, COALESCE(loyalty_member_enrolled_at, CURRENT_TIMESTAMP)');
    expect(sql).toContain('loyalty_member_opted_out_at = IF(loyalty_member = 1 AND ? = 0, CURRENT_TIMESTAMP');
    expect(params).toEqual([1, 1, 1, 42]);
  });

  it('records opt-out without clearing enrollment history', async () => {
    mockImsQuery.mockResolvedValue([{ type: 'retail_customer', loyalty_member: 1 }]);

    await ImsContactsRepo.update(42, { loyalty_member: 0 });

    const [sql, params] = mockImsExecute.mock.calls[0];
    expect(sql).not.toContain('loyalty_member_enrolled_at = NULL');
    expect(params).toEqual([0, 0, 0, 42]);
  });

  it('cannot enroll a supplier as a loyalty member', async () => {
    mockImsQuery.mockResolvedValue([{ type: 'supplier', loyalty_member: 0 }]);

    await ImsContactsRepo.update(42, { loyalty_member: 1 });

    expect(mockImsExecute.mock.calls[0][1]).toEqual([0, 0, 0, 42]);
  });
});