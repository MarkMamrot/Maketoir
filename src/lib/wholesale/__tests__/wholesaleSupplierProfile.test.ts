import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecute, mockQuery } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({
  execute: mockExecute,
  query: mockQuery,
}));

import {
  normalizeWholesaleSupplierSlug,
  validateWholesaleSupplierSlug,
  WholesaleSupplierProfileRepository,
} from '../wholesaleSupplierProfile';

describe('wholesale supplier profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes supplier names into stable public slugs', () => {
    expect(normalizeWholesaleSupplierSlug('  Café & Company  ')).toBe('cafe-company');
    expect(normalizeWholesaleSupplierSlug('ACME---Wholesale')).toBe('acme-wholesale');
  });

  it('rejects empty, short, and reserved slugs', () => {
    expect(() => validateWholesaleSupplierSlug('a')).toThrow('at least 3');
    expect(() => validateWholesaleSupplierSlug('Login')).toThrow('reserved');
    expect(() => validateWholesaleSupplierSlug('***')).toThrow('at least 3');
  });

  it('resolves an active supplier through a non-deleted business', async () => {
    mockQuery.mockResolvedValueOnce([{
      business_id: 'biz-1',
      slug: 'monsterthreads',
      display_name: 'Monsterthreads',
      logo_url: 'https://example.com/logo.png',
      support_email: 'sales@example.com',
      is_active: 1,
    }]);

    await expect(WholesaleSupplierProfileRepository.getActiveBySlug(' MonsterThreads ')).resolves.toEqual({
      businessId: 'biz-1',
      slug: 'monsterthreads',
      displayName: 'Monsterthreads',
      logoUrl: 'https://example.com/logo.png',
      supportEmail: 'sales@example.com',
      isActive: true,
    });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('b.deleted_at IS NULL'), ['monsterthreads']);
  });

  it('does not query reserved public route names', async () => {
    await expect(WholesaleSupplierProfileRepository.getActiveBySlug('apply')).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('normalizes supplier fields before upsert', async () => {
    mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

    await WholesaleSupplierProfileRepository.upsert({
      businessId: 'biz-1',
      slug: ' Monster Threads ',
      displayName: ' Monsterthreads ',
      logoUrl: ' https://example.com/logo.png ',
      supportEmail: ' SALES@EXAMPLE.COM ',
    });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO wholesale_supplier_profiles'),
      ['biz-1', 'monster-threads', 'Monsterthreads', 'https://example.com/logo.png', 'sales@example.com', 1],
    );
  });

  it('creates a supplier profile from the business and brand identity', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        business_id: 'biz-1',
        name: 'Monster Threads',
        logo_url: 'https://example.com/logo.png',
      }])
      .mockResolvedValueOnce([]);
    mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

    await expect(WholesaleSupplierProfileRepository.ensureForBusiness('biz-1')).resolves.toEqual({
      businessId: 'biz-1',
      slug: 'monster-threads',
      displayName: 'Monster Threads',
      logoUrl: 'https://example.com/logo.png',
      supportEmail: null,
      isActive: true,
    });
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO wholesale_supplier_profiles'),
      ['biz-1', 'monster-threads', 'Monster Threads', 'https://example.com/logo.png', null, 1],
    );
  });

  it('reactivates an existing profile without changing its slug', async () => {
    mockQuery.mockResolvedValueOnce([{
      business_id: 'biz-1',
      slug: 'established-slug',
      display_name: 'Supplier',
      logo_url: null,
      support_email: null,
      is_active: 0,
    }]);
    mockExecute.mockResolvedValueOnce({ affectedRows: 1 });

    await expect(WholesaleSupplierProfileRepository.ensureForBusiness('biz-1')).resolves.toMatchObject({
      slug: 'established-slug',
      isActive: true,
    });
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE wholesale_supplier_profiles SET is_active = 1 WHERE business_id = ?',
      ['biz-1'],
    );
  });
});