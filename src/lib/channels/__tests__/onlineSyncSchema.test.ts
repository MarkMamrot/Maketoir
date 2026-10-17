import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ONLINE_SYNC_BATCH_COLUMNS, ONLINE_SYNC_JOB_COLUMNS, ONLINE_SYNC_ORDER_COLUMNS, ONLINE_SYNC_CONTROL_COLUMNS, ONLINE_SYNC_TENANT_TABLES,
  installOnlineSyncMainSchema, installOnlineSyncTenantSchema, onlineSyncTableDdl,
} from '../../../../scripts/online-sync-schema.mjs';

describe('additive online sync schema', () => {
  it('loads every canonical table without any activation or historical data writes', async () => {
    const query = vi.fn().mockResolvedValue([[{ COLUMN_NAME: 'id' }], []]);
    await installOnlineSyncTenantSchema({ query });
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(4);
    expect(statements.filter(sql => sql.startsWith('ALTER TABLE'))).toHaveLength(
      Object.keys(ONLINE_SYNC_JOB_COLUMNS).length + Object.keys(ONLINE_SYNC_ORDER_COLUMNS).length
        + Object.keys(ONLINE_SYNC_CONTROL_COLUMNS).length,
    );
    expect(statements[0]).toBe('SET SESSION lock_wait_timeout = 5');
    expect(statements.some(sql => /^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i.test(sql))).toBe(false);
    const canonical = await readFile(path.join(process.cwd(), 'scripts', 'ims-schema.sql'), 'utf8');
    for (const table of ONLINE_SYNC_TENANT_TABLES) {
      const ddl = onlineSyncTableDdl(canonical, table);
      expect(ddl).toContain('utf8mb4_bin');
    }
    expect(onlineSyncTableDdl(canonical, 'ims_online_sync_control')).toContain("DEFAULT 'legacy'");
  });
  it('adds no existing columns on rerun and fails instead of skipping a missing base table', async () => {
    const query = vi.fn().mockResolvedValue([
      Object.keys({ ...ONLINE_SYNC_JOB_COLUMNS, ...ONLINE_SYNC_CONTROL_COLUMNS }).map(COLUMN_NAME => ({ COLUMN_NAME })), [],
    ]);
    await installOnlineSyncTenantSchema({ query });
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('ALTER TABLE'))).toBe(false);
    query.mockResolvedValue([[], []]);
    await expect(installOnlineSyncTenantSchema({ query })).rejects.toThrow('requires existing table ims_sales_channel_jobs');
  });
  it('upgrades a previously installed recovery table without replacing order state', async () => {
    const query = vi.fn(async (sql: string, params?: string[]) => {
      if (sql.includes('information_schema.COLUMNS')) {
        return [Object.keys(params?.[0] === 'ims_sales_channel_jobs'
          ? ONLINE_SYNC_JOB_COLUMNS : { business_id: '', effects_json: '' })
          .map(COLUMN_NAME => ({ COLUMN_NAME })), []];
      }
      return [[], []];
    });
    await installOnlineSyncTenantSchema({ query });
    const alterations = query.mock.calls.map(([sql]) => sql).filter(sql => sql.startsWith('ALTER TABLE'));
    expect(alterations).toHaveLength(2 + Object.keys(ONLINE_SYNC_CONTROL_COLUMNS).length);
    for (const column of Object.keys(ONLINE_SYNC_ORDER_COLUMNS)) {
      expect(alterations.some(sql => sql.includes(`\`ims_shopify_order_recovery\` ADD COLUMN \`${column}\``))).toBe(true);
    }
    expect(query.mock.calls.some(([sql]) => /^\s*(DROP|DELETE|UPDATE|INSERT)\b/.test(sql))).toBe(false);
  });
  it('installs main columns and index without running the broad Xero historical-backfill script', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('COLUMNS') ? [[{ COLUMN_NAME: 'id' }], []] : [[], []]);
    await installOnlineSyncMainSchema({ query });
    expect(query.mock.calls.filter(([sql]) => sql.startsWith('ALTER TABLE'))).toHaveLength(Object.keys(ONLINE_SYNC_BATCH_COLUMNS).length + 1);
    const canonical = await readFile(path.join(process.cwd(), 'scripts', 'setup-xero-tables.sql'), 'utf8');
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
    for (const [column, definition] of Object.entries(ONLINE_SYNC_BATCH_COLUMNS)) {
      expect(normalize(canonical)).toContain(`${column} ${normalize(definition)}`);
    }
    expect(query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE|DELETE|DROP)\b/i.test(sql))).toBe(false);
  });
  it('fails immediately on DDL errors and validates identifiers', async () => {
    const query = vi.fn().mockRejectedValue(new Error('metadata lock wait'));
    await expect(installOnlineSyncMainSchema({ query })).rejects.toThrow('metadata lock wait');
    await expect(installOnlineSyncTenantSchema({ query })).rejects.toThrow('metadata lock wait');
    expect(() => onlineSyncTableDdl('', 'ims_orders; DROP DATABASE x')).toThrow('Invalid online sync table identifier');
    expect(() => onlineSyncTableDdl('', 'ims_online_sync_control')).toThrow('Missing canonical');
  });
});
