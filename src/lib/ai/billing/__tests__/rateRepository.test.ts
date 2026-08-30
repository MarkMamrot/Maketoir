import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPool: vi.fn(), query: vi.fn() }));

vi.mock('@/services/MySQLService', () => ({ getPool: mocks.getPool, query: mocks.query }));

import { AiRateRepository } from '../rateRepository';
import type { GoogleRateCandidate } from '../googlePricing';

const candidate = (skuId: string): GoogleRateCandidate => ({
  id: `${skuId}:input_tokens`,
  skuId,
  skuName: `Gemini 2.5 Pro Input Tokens ${skuId}`,
  priceName: `billingAccounts/a/skus/${skuId}/price`,
  modelId: 'gemini-2.5-pro',
  metric: 'input_tokens',
  priceAud: '2',
  unitScale: 1_000_000,
  sourceCurrency: 'AUD',
  sourcePriceDecimal: '2',
  audFxRate: '1',
});

describe('AI rate repository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects duplicate Google model metrics before opening a transaction', async () => {
    await expect(AiRateRepository.importGoogle([candidate('SKU-A'), candidate('SKU-B')], 7))
      .rejects.toThrow('duplicate model metrics');
    expect(mocks.getPool).not.toHaveBeenCalled();
  });
});