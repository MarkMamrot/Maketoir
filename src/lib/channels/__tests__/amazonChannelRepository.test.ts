import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  execute: vi.fn(), encrypt: vi.fn(() => 'encrypted-envelope'),
}));

vi.mock('@/services/MySQLService', () => ({ getPool: () => ({ getConnection: mocks.getConnection }) }));
vi.mock('@/lib/encryption', () => ({ encrypt: mocks.encrypt }));

import { authorizeAmazonChannel } from '../amazonChannelRepository';

describe('authorizeAmazonChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnection.mockResolvedValue({
      beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback,
      release: mocks.release, execute: mocks.execute,
    });
    mocks.execute.mockResolvedValueOnce([[]]);
  });

  it('creates a separate setup-pending instance with encrypted credentials', async () => {
    const id = await authorizeAmazonChannel({
      businessId: 'business-1', sellerId: 'a1seller99', displayName: 'Amazon Retail',
      storeName: 'Retail AU', refreshToken: 'refresh-secret',
    });

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.execute.mock.calls[1][0]).toContain("VALUES (?, ?, 'amazon'");
    expect(mocks.execute.mock.calls[1][1]).toEqual(expect.arrayContaining([id, 'business-1', 'Amazon Retail', 'A1SELLER99']));
    expect(mocks.encrypt).toHaveBeenCalledWith(expect.stringContaining('refresh-secret'));
    expect(mocks.execute.mock.calls[2][0]).toContain("'amazon_sp_api'");
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('reauthorizes the same business instance without resetting runtime state', async () => {
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValueOnce([[
      { channel_instance_id: 'instance-1', business_id: 'business-1', settings_json: '{"inventoryPolicy":"buffered"}' },
    ]]);

    await authorizeAmazonChannel({
      businessId: 'business-1', sellerId: 'A1SELLER99', displayName: 'Amazon Retail',
      storeName: 'Retail AU', refreshToken: 'new-refresh-secret',
    });

    const updateSql = mocks.execute.mock.calls[1][0] as string;
    expect(updateSql).toContain('settings_json = ?');
    expect(updateSql).not.toContain('is_enabled =');
    expect(updateSql).not.toContain("runtime_status = 'draft'");
    expect(JSON.parse(mocks.execute.mock.calls[1][1][1])).toMatchObject({
      inventoryPolicy: 'buffered', region: 'far_east',
    });
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it('rejects a seller account owned by another business and rolls back', async () => {
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValueOnce([[{ channel_instance_id: 'instance-1', business_id: 'business-2' }]]);

    await expect(authorizeAmazonChannel({
      businessId: 'business-1', sellerId: 'A1SELLER99', displayName: 'Amazon Retail',
      storeName: 'Retail AU', refreshToken: 'refresh-secret',
    })).rejects.toThrow('already connected to another business');
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
