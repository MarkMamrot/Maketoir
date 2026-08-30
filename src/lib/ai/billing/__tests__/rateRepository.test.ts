import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPool: vi.fn(), query: vi.fn() }));

vi.mock('@/services/MySQLService', () => ({ getPool: mocks.getPool, query: mocks.query }));

import { AiRateRepository, applyMarkup, parseMarkupBasisPoints } from '../rateRepository';
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

  it('widens legacy rate metric enums before importing new Google metrics', async () => {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn(),
    };
    connection.execute.mockResolvedValueOnce([[]]).mockResolvedValue([{}]);
    const pool = {
      execute: vi.fn()
        .mockResolvedValueOnce([[{ TABLE_NAME: 'ai_provider_rates', COLUMN_TYPE: "enum('input_tokens')" }, { TABLE_NAME: 'ai_plan_rates', COLUMN_TYPE: "enum('input_tokens')" }]])
        .mockResolvedValue([{}]),
      getConnection: vi.fn().mockResolvedValue(connection),
    };
    mocks.getPool.mockReturnValue(pool);
    await expect(AiRateRepository.importGoogle([candidate('SKU-A')], 7)).resolves.toEqual({ imported: 1, skipped: 0 });
    expect(pool.execute).toHaveBeenCalledWith(expect.stringContaining('ALTER TABLE ai_provider_rates MODIFY metric'));
    expect(pool.execute).toHaveBeenCalledWith(expect.stringContaining('ALTER TABLE ai_plan_rates MODIFY metric'));
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('calculates decimal percentage markups exactly and rounds up to one micro', () => {
    expect(parseMarkupBasisPoints('27.50')).toBe(2_750n);
    expect(applyMarkup(1_000_001n, 2_750n)).toBe(1_275_002n);
  });

  it('persists plan pricing modes and markups in one transaction', async () => {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn(),
    };
    connection.execute.mockResolvedValue([{}]);
    mocks.getPool.mockReturnValue({ getConnection: () => Promise.resolve(connection) });
    await expect(AiRateRepository.savePlanPricing({ starter: { pricingMode: 'markup', markupPercent: '25' }, core: { pricingMode: 'rates', markupPercent: '10.5' } })).resolves.toEqual({ plans: 2 });
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE ai_plans'), ['markup', 2500, 'starter']);
    expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE ai_plans'), ['rates', 1050, 'core']);
  });
});