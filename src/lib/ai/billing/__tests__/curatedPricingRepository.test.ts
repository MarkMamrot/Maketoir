import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPool: vi.fn(), query: vi.fn(), ensureSchema: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ getPool: mocks.getPool, query: mocks.query }));
vi.mock('../commercialSchema', () => ({ ensureAiCommercialSchema: mocks.ensureSchema }));

import { CuratedPricingRepository, parseAudPerUsd } from '../curatedPricingRepository';

describe('curated pricing repository', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.ensureSchema.mockResolvedValue(undefined); });

  it('validates the editable AUD per USD rate', () => {
    expect(parseAudPerUsd('1.52345678')).toBe('1.52345678');
    expect(() => parseAudPerUsd('0')).toThrow('greater than zero');
    expect(() => parseAudPerUsd('1.123456789')).toThrow('eight decimal');
  });

  it('installs rates before activating exactly six models and forcing five markup plans', async () => {
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn(async (sql: string) => sql.startsWith('SELECT metric') ? [[]] : [{}]),
    };
    mocks.getPool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(connection) });
    const markups = { starter: '20', core: '18', scale: '15', enterprise: '10', platform: '0' };
    await expect(CuratedPricingRepository.save({ audPerUsd: '1.52', markups }, 7)).resolves.toEqual({ models: 6, updatedModels: 6, plans: 5 });
    const sql = connection.execute.mock.calls.map(call => String(call[0]));
    const disableIndex = sql.findIndex(statement => statement.includes('UPDATE ai_provider_models SET is_allowed=0'));
    const lastRateInsert = sql.map((statement, index) => statement.includes('INSERT INTO ai_provider_rates') ? index : -1).filter(index => index >= 0).at(-1)!;
    expect(disableIndex).toBeGreaterThan(lastRateInsert);
    expect(sql.filter(statement => statement.includes("VALUES ('google',?,1)")).length).toBe(6);
    expect(sql.filter(statement => statement.includes("pricing_mode='markup'")).length).toBe(5);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});