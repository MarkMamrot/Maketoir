import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/services/MySQLService', () => ({ query: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { GET } from '../route';
import { GET as GET_DAY } from '../../day/route';

describe('open online sales with canonical item columns', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'test-business' });
    mocks.query.mockResolvedValue([]);
  });

  it('loads names and SKU aliases through collation-safe catalogue joins', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 42 }]).mockResolvedValueOnce([{ id: 8, so_id: 42, catalogue_sku: 'SKU', product_name: 'Product' }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orders: [{ id: 42, items: [{ name: 'Product', code: 'SKU' }] }] });
    const sql = mocks.query.mock.calls[1][0];
    expect(sql).not.toMatch(/\bi\.(name|code)\b/);
    expect(sql).toContain('BINARY v.variant_id = BINARY i.variant_id');
    expect(sql).toContain('p.name AS product_name');
    expect(mocks.query.mock.calls[0][1]).toEqual(['test-business']);
    expect(mocks.query.mock.calls[1][1]).toEqual([42]);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('preserves legacy names and codes when the catalogue link is missing', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 42 }]).mockResolvedValueOnce([{ id: 8, so_id: 42, name: 'Saved label', code: 'OLD-SKU', catalogue_sku: null, product_name: null }]);
    expect(await (await GET()).json()).toMatchObject({ orders: [{ items: [{ name: 'Saved label', sku: 'OLD-SKU', code: 'OLD-SKU', product_name: 'Saved label' }] }] });
  });

  it.each([undefined, 'Saved label'])('loads day details without requiring legacy name (%s)', async legacyName => {
    mocks.query.mockResolvedValueOnce([{ id: 42 }]).mockResolvedValueOnce([{ id: 8, so_id: 42, name: legacyName, product_name: legacyName ? null : 'Catalogue label' }]);
    const response = await GET_DAY(new NextRequest('http://localhost/api/ims/online-sales/day?date=2026-10-06&channelInstanceId=store-1'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orders: [{ items: [{ product_name: legacyName ?? 'Catalogue label' }] }] });
    expect(mocks.query.mock.calls[1][0]).not.toMatch(/\bi\.name\b/);
    expect(mocks.query.mock.calls[0][1]).toEqual(['test-business', 'store-1', '2026-10-06']);
  });

  it('skips line loading when there are no open orders', async () => {
    mocks.query.mockResolvedValueOnce([]);
    expect((await GET()).status).toBe(200);
    expect(mocks.query).toHaveBeenCalledOnce();
  });
});