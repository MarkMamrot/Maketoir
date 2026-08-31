import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPool: vi.fn(), query: vi.fn(), ensureSchema: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ getPool: mocks.getPool, query: mocks.query }));
vi.mock('../commercialSchema', () => ({ ensureAiCommercialSchema: mocks.ensureSchema }));

import { AiModelCatalogRepository } from '../modelCatalogRepository';
import type { CanonicalAiModel } from '../modelCatalog';

const model: CanonicalAiModel = { provider: 'google', modelId: 'gemini-new', displayName: 'Gemini New', version: '1', supportedGenerationMethods: ['generateContent'], inputModalities: ['text'], outputModalities: ['text'], inputTokenLimit: 1000, outputTokenLimit: 1000, lifecycleStatus: 'active' };

describe('AI model catalog repository', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.ensureSchema.mockResolvedValue(undefined); });

  it('upserts seen models and retires unseen models transactionally', async () => {
    const connection = { beginTransaction: vi.fn(), execute: vi.fn().mockResolvedValue([{}]), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
    const pool = { execute: vi.fn().mockResolvedValue([{}]), getConnection: vi.fn().mockResolvedValue(connection) };
    mocks.getPool.mockReturnValue(pool);
    await expect(AiModelCatalogRepository.discover([model])).resolves.toEqual({ discovered: 1 });
    expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining('ON DUPLICATE KEY UPDATE'), expect.arrayContaining(['gemini-new']));
    expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining("lifecycle_status='retired'"), ['gemini-new']);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('creates a versioned mapping and audit record in one transaction', async () => {
    const connection = { beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
    connection.execute.mockResolvedValueOnce([[{ next_version: 3 }]]).mockResolvedValueOnce([{ insertId: 12 }]).mockResolvedValueOnce([{}]);
    const pool = { execute: vi.fn().mockResolvedValue([{}]), getConnection: vi.fn().mockResolvedValue(connection) };
    mocks.getPool.mockReturnValue(pool);
    mocks.query.mockResolvedValue([{ present: 1 }]);
    await expect(AiModelCatalogRepository.saveMapping({ modelId: 'gemini-new', familyPattern: 'Gemini New', matchType: 'contains' }, 7)).resolves.toEqual(expect.objectContaining({ id: 12, mappingVersion: 3 }));
    expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining('ai_billing_mapping_audit'), [12, expect.any(String), 7]);
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});