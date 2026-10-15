import { beforeEach, describe, expect, it, vi } from 'vitest';
import amazonPiiGuards from '../../../../scripts/amazon-pii-guards.json';

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
  provisionBusinessIms,
  validateImsSchema,
} from '../provisionBusiness';
import { IMS_SCHEMA_IDENTITY_COLUMNS, IMS_SCHEMA_REQUIRED_COLUMNS, IMS_SCHEMA_REQUIRED_INDEXES, IMS_SCHEMA_REQUIRED_TABLES } from '../schemaContract';

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

  it('does not split on semicolons inside quoted SQL values', () => {
    const statements = parseSchemaStatements(`
      CREATE TABLE gift_cards (
        initial_balance DECIMAL(12,2) NULL COMMENT 'Face value when issued; NULL = unknown (imported)',
        label VARCHAR(100) DEFAULT 'Customer''s card; active'
      );
      CREATE TABLE products (id BIGINT PRIMARY KEY);
    `);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("COMMENT 'Face value when issued; NULL = unknown (imported)'");
    expect(statements[0]).toContain("DEFAULT 'Customer''s card; active'");
    expect(statements[1]).toBe('CREATE TABLE products (id BIGINT PRIMARY KEY)');
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

  it('automatically provisions and validates both Amazon delivery tables before linking a new tenant', async () => {
    const requiredColumns = new Map<string, readonly string[]>(Object.entries(IMS_SCHEMA_REQUIRED_COLUMNS));
    mocks.serverConnection.query.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.COLUMNS')) return [IMS_SCHEMA_REQUIRED_TABLES.flatMap(table =>
        [...new Set(['business_id', ...(requiredColumns.get(table) ?? [])])].map(column => ({
          TABLE_NAME: table, COLUMN_NAME: column,
          COLLATION_NAME: IMS_SCHEMA_IDENTITY_COLUMNS.some(identity => identity === column) ? 'utf8mb4_bin' : 'utf8mb4_unicode_ci',
        }))), []];
      if (sql.includes('information_schema.TABLES')) return [
        IMS_SCHEMA_REQUIRED_TABLES.map(TABLE_NAME => ({ TABLE_NAME, TABLE_COLLATION: 'utf8mb4_unicode_ci' })), []];
      if (sql.includes('information_schema.STATISTICS')) return [
        Object.entries(IMS_SCHEMA_REQUIRED_INDEXES).flatMap(([TABLE_NAME, names]) => names.map(INDEX_NAME => ({ TABLE_NAME, INDEX_NAME }))), []];
      if (sql.includes('information_schema.TRIGGERS')) return [
        ['trg_ims_stock_bizid', 'trg_ims_sales_cache_bizid', 'trg_ims_stock_movement_bizid', ...amazonPiiGuards.map(guard => guard.name)].map(TRIGGER_NAME => ({ TRIGGER_NAME })), []];
      return [[], []];
    });
    const result = await provisionBusinessIms({ businessId: 'test-new-tenant', businessName: 'Future Retail' });
    expect(result.created).toBe(true);
    for (const table of ['ims_amazon_delivery_evidence', 'ims_amazon_delivery_poll_state', 'ims_amazon_pii_disposals']) {
      expect(mocks.serverConnection.query.mock.calls.filter(([sql]) => sql.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`))).toHaveLength(1);
    }
    for (const guard of amazonPiiGuards) {
      expect(mocks.serverConnection.query.mock.calls.some(([sql]) => sql.startsWith(`CREATE TRIGGER \`${guard.name}\``))).toBe(true);
    }
    expect(mocks.serverConnection.query.mock.calls.some(([sql]) => sql.includes('information_schema.STATISTICS'))).toBe(true);
    expect(mocks.mainExecute).toHaveBeenCalledWith(expect.stringContaining('UPDATE businesses SET ims_db_name'), [result.imsDbName, 'test-new-tenant']);
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

  it('rejects a fresh schema with a non-binary textual identity', async () => {
    mocks.serverConnection.query
      .mockResolvedValueOnce([[{
        TABLE_NAME: 'ims_products',
        COLUMN_NAME: 'business_id',
        COLLATION_NAME: 'utf8mb4_general_ci',
      }], []])
      .mockResolvedValueOnce([[{
        TABLE_NAME: 'ims_products',
        TABLE_COLLATION: 'utf8mb4_unicode_ci',
      }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);

    await expect(validateImsSchema('readyedu_TestIMS')).rejects.toThrow(
      'collation:ims_products.business_id (utf8mb4_general_ci)',
    );
  });
});