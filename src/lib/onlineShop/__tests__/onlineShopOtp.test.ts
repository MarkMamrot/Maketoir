import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, connection } = vi.hoisted(() => {
  const execute = vi.fn();
  return {
    execute,
    connection: { beginTransaction: vi.fn(), execute, commit: vi.fn(), rollback: vi.fn(), release: vi.fn() },
  };
});

vi.mock('@/services/MySQLService', () => ({ getPool: () => ({ getConnection: async () => connection }) }));

import { createCustomerOtp, createOnlineShopOtp } from '../onlineShopOtp';

describe('customer OTP purposes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-only-customer-otp-secret-at-least-32-bytes');
    execute.mockResolvedValue([{}]);
  });

  it('isolates loyalty challenges by purpose', async () => {
    await createCustomerOtp({ businessId: 'biz-1', contactId: 42, email: 'buyer@example.com', purpose: 'loyalty_portal' });
    expect(execute.mock.calls[0][0]).toContain('purpose = ?');
    expect(execute.mock.calls[0][1]).toEqual(['biz-1', 'buyer@example.com', 'loyalty_portal']);
    expect(execute.mock.calls[1][1][3]).toBe('loyalty_portal');
  });

  it('keeps native-shop callers on their existing purpose', async () => {
    await createOnlineShopOtp({ businessId: 'biz-1', contactId: 42, email: 'buyer@example.com' });
    expect(execute.mock.calls[0][1][2]).toBe('native_shop');
    expect(execute.mock.calls[1][1][3]).toBe('native_shop');
  });
});