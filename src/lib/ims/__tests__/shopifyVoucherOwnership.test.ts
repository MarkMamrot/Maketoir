import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({
  imsExecute: mocks.execute,
  imsQuery: vi.fn(),
  getIMSPool: vi.fn(),
}));

import { LoyaltyRepository } from '@/lib/ims/LoyaltyRepository';

describe('Shopify voucher ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
  });

  it('requires the exact instance customer mapping before consuming a voucher', async () => {
    await expect(LoyaltyRepository.markShopifyVoucherUsed(
      'business-1', 'reward-10', 'customer-2', 'instance-2',
    )).resolves.toBe(true);

    expect(mocks.execute.mock.calls[0][0]).toContain('ims_contact_channel_mappings');
    expect(mocks.execute.mock.calls[0][0]).toContain("mapping.mapping_status = 'linked'");
    expect(mocks.execute.mock.calls[0][1]).toEqual([
      'instance-2', 'customer-2', 'business-1', 'REWARD-10',
    ]);
  });
});