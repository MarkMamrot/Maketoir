import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn(), query: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({
  query: mocks.query,
  getPool: () => ({ getConnection: async () => ({
    beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback,
    release: mocks.release, execute: mocks.execute,
  }) }),
}));

import { createDefaultOnlineShopLayout } from '../layout/validation';
import { OnlineShopLayoutRepository, OnlineShopLayoutRevisionConflictError } from '../onlineShopLayout';
import { normalizeOnlineShopPageSlug, OnlineShopPageRepository } from '../onlineShopPages';

describe('online shop persistence', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
  });

  it('rolls back stale layout drafts and reports the current revision', async () => {
    mocks.execute.mockResolvedValueOnce([[{ draft_revision: 4 }], []]);
    await expect(OnlineShopLayoutRepository.saveDraft(
      'business-1', createDefaultOnlineShopLayout(), 3, { userId: 7, name: 'Admin' },
    )).rejects.toEqual(expect.objectContaining<Partial<OnlineShopLayoutRevisionConflictError>>({ currentRevision: 4 }));
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('uses published and visible gates for public content pages', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(OnlineShopPageRepository.getPublishedBySlug('business-1', 'Returns Policy')).resolves.toBeNull();
    expect(mocks.query.mock.calls[0][0]).toContain('is_visible = 1 AND published_json IS NOT NULL');
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'returns-policy']);
  });

  it('normalizes stable page slugs', () => {
    expect(normalizeOnlineShopPageSlug(' About Us! ')).toBe('about-us');
  });
});