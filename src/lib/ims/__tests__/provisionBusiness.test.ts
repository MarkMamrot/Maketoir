import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createConnection: vi.fn(),
  mainQuery: vi.fn(),
  mainExecute: vi.fn(),
  poolConnection: {
    beginTransaction: vi.fn(),
    execute: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  },
  serverConnection: {
    query: vi.fn(),
    end: vi.fn(),
  },
  invalidate: vi.fn(),
}));

vi.mock('mysql2/promise', () => ({
  default: { createConnection: mocks.createConnection },
}));
vi.mock('@/services/MySQLService', () => ({
  execute: mocks.mainExecute,
  query: mocks.mainQuery,
  getPool: () => ({ getConnection: vi.fn().mockResolvedValue(mocks.poolConnection) }),
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ invalidateImsDbCache: mocks.invalidate }));

import {
  cleanupFailedBusinessProvision,
  deriveProvisionedImsDbName,
  parseSchemaStatements,
} from '../provisionBusiness';

describe('IMS schema statement parsing', () => {
  it('does not treat text after a semicolon in a comment as SQL', () => {
    const statements = parseSchemaStatements(`
      -- Up to 8 images per product; one marked is_primary (used by POS/website).
      CREATE TABLE ims_product_images (id BIGINT PRIMARY KEY);
      CREATE TABLE ims_products (id BIGINT PRIMARY KEY);
    `);

    expect(statements).toEqual([
      'CREATE TABLE ims_product_images (id BIGINT PRIMARY KEY)',
      'CREATE TABLE ims_products (id BIGINT PRIMARY KEY)',
    ]);
  });
});

describe('new business IMS provisioning ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createConnection.mockResolvedValue(mocks.serverConnection);
    mocks.serverConnection.query.mockResolvedValue([[], []]);
    mocks.mainQuery.mockResolvedValue([]);
    mocks.poolConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it('includes the business id in generated schema names', () => {
    const first = deriveProvisionedImsDbName('Same Business', 'business-one');
    const second = deriveProvisionedImsDbName('Same Business', 'business-two');

    expect(first).not.toBe(second);
    expect(first).toMatch(/SameBusiness_businessoneIMS$/);
  });

  it('never drops a schema that this request did not create', async () => {
    await cleanupFailedBusinessProvision({
      businessId: 'business-1',
      imsDbName: 'readyedu_ExistingIMS',
      schemaCreated: false,
      businessCreated: false,
    });

    expect(mocks.createConnection).not.toHaveBeenCalled();
    expect(mocks.poolConnection.execute).not.toHaveBeenCalled();
  });

  it('drops an owned unreferenced schema and deletes request-created main records', async () => {
    const result = await cleanupFailedBusinessProvision({
      businessId: 'business-1',
      imsDbName: 'readyedu_NewBusiness_business1IMS',
      schemaCreated: true,
      businessCreated: true,
    });

    expect(mocks.serverConnection.query).toHaveBeenCalledWith(
      'DROP DATABASE IF EXISTS `readyedu_NewBusiness_business1IMS`',
    );
    expect(mocks.poolConnection.execute.mock.calls.map(call => call[0])).toEqual([
      'DELETE FROM config WHERE business_id = ?',
      'DELETE FROM business_info WHERE business_id = ?',
      'DELETE FROM users WHERE business_id = ?',
      'DELETE FROM businesses WHERE business_id = ?',
    ]);
    expect(result).toEqual({ schemaDropped: true, businessDeleted: true, errors: [] });
  });

  it('does not drop an owned schema referenced by another active business', async () => {
    mocks.mainQuery.mockResolvedValue([{ business_id: 'business-2' }]);

    const result = await cleanupFailedBusinessProvision({
      businessId: 'business-1',
      imsDbName: 'readyedu_SharedIMS',
      schemaCreated: true,
      businessCreated: false,
    });

    expect(mocks.createConnection).not.toHaveBeenCalled();
    expect(result.schemaDropped).toBe(false);
    expect(result.errors[0]).toContain('referenced by another active business');
  });
});