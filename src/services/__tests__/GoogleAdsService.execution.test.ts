import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockMutateResources, mockCustomer } = vi.hoisted(() => ({
  mockMutateResources: vi.fn(),
  mockCustomer: vi.fn(),
}));

vi.mock('google-ads-api', () => ({
  GoogleAdsApi: class {
    Customer(options: unknown) {
      mockCustomer(options);
      return { mutateResources: mockMutateResources };
    }
  },
}));

import { GoogleAdsService } from '../GoogleAdsService';

describe('GoogleAdsService controlled budget execution', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submits only exact campaign-budget updates atomically', async () => {
    mockMutateResources.mockResolvedValue({ mutate_operation_responses: [{}] });
    const service = new GoogleAdsService('111-222-3333', 'tenant-refresh-token');

    await service.updateCampaignBudgets([{ budgetId: '456', amountMicros: 92_000_000 }]);

    expect(mockCustomer).toHaveBeenCalledWith({
      customer_id: '1112223333', refresh_token: 'tenant-refresh-token',
    });
    expect(mockMutateResources).toHaveBeenCalledWith([{
      entity: 'campaign_budget',
      operation: 'update',
      resource: {
        resource_name: 'customers/1112223333/campaignBudgets/456',
        amount_micros: 92_000_000,
      },
    }], { partial_failure: false });
  });

  it('rejects invalid or duplicate budget IDs before calling Google', async () => {
    const service = new GoogleAdsService('1112223333', 'tenant-refresh-token');
    await expect(service.updateCampaignBudgets([{ budgetId: 'bad', amountMicros: 92_000_000 }]))
      .rejects.toThrow('must be numeric');
    await expect(service.updateCampaignBudgets([
      { budgetId: '456', amountMicros: 92_000_000 },
      { budgetId: '456', amountMicros: 91_000_000 },
    ])).rejects.toThrow('Duplicate');
    expect(mockMutateResources).not.toHaveBeenCalled();
  });
});