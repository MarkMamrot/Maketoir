import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogueTriggers, installCatalogueTracking } from '../../../../scripts/pos-catalogue-triggers.mjs';
import { catalogueSync, withLegacyCatalogueLease, type CatalogueRequest } from '../catalogueSync.server';
import type { CatalogueDelivery } from '../catalogueProtocol';

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: vi.fn() }));

const port = Number(process.env.POS_CATALOGUE_TEST_PORT);
const password = process.env.POS_CATALOGUE_TEST_PASSWORD ?? '';
const tables = [
  'ims_products', 'ims_product_variants', 'ims_locations', 'ims_settings', 'ims_stock', 'ims_product_images',
  'ims_product_build_recipes', 'ims_product_build_recipe_versions', 'ims_product_build_recipe_components',
  'pos_catalogue_control', 'pos_catalogue_changes', 'pos_catalogue_consumers', 'pos_catalogue_acknowledgements',
];
const schema = `pos_catalogue_test_${randomUUID().replaceAll('-', '')}`;
let pool: Pool;
const consumer = () => ({ consumerId: randomUUID(), full: false });
function delivered(value: Awaited<ReturnType<typeof catalogueSync>>): CatalogueDelivery {
  if (!('mode' in value) || (value.mode !== 'delta' && value.mode !== 'full')) throw new Error(`Expected delivery: ${JSON.stringify(value)}`);
  return value;
}
async function sync(request: CatalogueRequest) {
  const connection = await pool.getConnection();
  try { return await catalogueSync(connection, 'alpha', 1, request); } finally { connection.release(); }
}
async function ack(value: CatalogueDelivery) { return sync({ consumerId: value.consumerId, full: false, ack: value.receipt }); }
async function baseline(request = consumer()) {
  const full = delivered(await sync(request));
  expect(full.mode).toBe('full');
  await ack(full);
  return request;
}

describe.skipIf(!port)('POS catalogue real MySQL transactions (loopback-only)', () => {
  beforeAll(async () => {
    if (!Number.isSafeInteger(port) || port <= 0) throw new Error('Explicit local test port required.');
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try { await server.query(`CREATE DATABASE \`${schema}\``); } finally { await server.end(); }
    pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', password, database: schema, connectionLimit: 6, dateStrings: true, timezone: 'Z' });
    const connection = await pool.getConnection();
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS=0');
      const canonical = await readFile(path.join(process.cwd(), 'scripts', 'ims-schema.sql'), 'utf8');
      for (const table of tables) {
        const ddl = canonical.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`))?.[0];
        if (!ddl) throw new Error(`Missing canonical table ${table}`);
        await connection.query(ddl);
      }
      await connection.query('SET FOREIGN_KEY_CHECKS=1');
      await installCatalogueTracking(connection);
    } finally { connection.release(); }
  }, 60_000);

  beforeEach(async () => {
    const connection = await pool.getConnection();
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS=0');
      for (const table of tables) await connection.query(`TRUNCATE TABLE \`${table}\``);
      await connection.query('SET FOREIGN_KEY_CHECKS=1');
      await connection.query("INSERT INTO pos_catalogue_control (business_id, epoch, ready) VALUES ('', UUID(), 1), ('alpha', UUID(), 1)");
      await connection.query("INSERT INTO ims_settings (business_id, `key`, value) VALUES ('alpha','pos_catalogue_sync_v2','yes')");
      await connection.query("INSERT INTO ims_products (business_id, product_id, name) VALUES ('alpha','p','Shirt')");
      await connection.query("INSERT INTO ims_product_variants (business_id, variant_id, product_id, sku, price_rrp) VALUES ('alpha','v','p','SKU',20)");
      await connection.query("INSERT INTO ims_locations (id,business_id,name) VALUES (1,'alpha','Branch')");
      await connection.query("INSERT INTO ims_stock (business_id, variant_id, location_id, qty_on_hand) VALUES ('alpha','v',1,10)");
    } finally { connection.release(); }
  });

  afterAll(async () => {
    if (pool) await pool.end();
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try {
      if (!/^pos_catalogue_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test cleanup target.');
      await server.query(`DROP DATABASE \`${schema}\``);
    } finally { await server.end(); }
  });

  it('installs all trigger definitions idempotently', async () => {
    const connection = await pool.getConnection();
    try {
      await installCatalogueTracking(connection);
      const [before] = await connection.query<RowDataPacket[]>('SELECT epoch FROM pos_catalogue_control WHERE business_id = ?', ['alpha']);
      await installCatalogueTracking(connection);
      const [after] = await connection.query<RowDataPacket[]>('SELECT epoch FROM pos_catalogue_control WHERE business_id = ?', ['alpha']);
      expect(after).toEqual(before);
      const [triggers] = await connection.query<RowDataPacket[]>('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()');
      expect(triggers).toHaveLength(catalogueTriggers.length);
    } finally { connection.release(); }
  });

  it('delivers full records initially then an empty delta', async () => {
    const request = await baseline();
    const delta = delivered(await sync(request));
    expect(delta.mode).toBe('delta');
    expect(delta.products).toEqual([]);
    expect(delta.removed).toEqual([]);
    await ack(delta);
  });

  it('rejects unsupported browsers before acquiring a lease or creating consumer state', async () => {
    await expect(sync({ ...consumer(), supportsLocks: false })).rejects.toMatchObject({ status: 426 });
    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM pos_catalogue_consumers');
    expect(Number(rows[0].count)).toBe(0);
    await pool.query("UPDATE ims_settings SET value='no' WHERE `key`='pos_catalogue_sync_v2'");
    expect(await sync({ ...consumer(), supportsLocks: false })).toMatchObject({ mode: 'disabled' });
  });

  it('replays the exact unacknowledged receipt and acknowledges idempotently', async () => {
    const request = consumer();
    const first = delivered(await sync(request));
    expect(await sync(request)).toEqual(first);
    const completion = await ack(first);
    expect(completion).toMatchObject({ acknowledged: true });
    expect(await ack(first)).toEqual(completion);
  });

  it('does not acknowledge a newer mutation that occurs while a response is in flight', async () => {
    const request = await baseline();
    await pool.query("UPDATE ims_product_variants SET barcode = 'NEW' WHERE variant_id = 'v'");
    const first = delivered(await sync(request));
    await pool.query("UPDATE ims_product_variants SET price_rrp = 25 WHERE variant_id = 'v'");
    await ack(first);
    const next = delivered(await sync(request));
    expect(next.products).toMatchObject([{ barcode: 'NEW', price: 25 }]);
  });

  it('sees a transaction committed after a newer unrelated transaction', async () => {
    const request = await baseline();
    const late = await pool.getConnection();
    try {
      await late.beginTransaction();
      await late.query("UPDATE ims_product_variants SET barcode = 'LATE' WHERE variant_id = 'v'");
      await pool.query("INSERT INTO ims_products (business_id,product_id,name) VALUES ('alpha','p2','Other')");
      await pool.query("INSERT INTO ims_product_variants (business_id,variant_id,product_id,price_rrp) VALUES ('alpha','v2','p2',5)");
      const early = delivered(await sync(request));
      expect(early.products.map(p => p.variant_id)).toEqual(['v2']);
      await ack(early);
      await late.commit();
      const next = delivered(await sync(request));
      expect(next.products).toMatchObject([{ variant_id: 'v', barcode: 'LATE' }]);
    } finally { await late.rollback(); late.release(); }
  });

  it('rollback cannot create a visible catalogue change', async () => {
    const request = await baseline();
    const writer = await pool.getConnection();
    try {
      await writer.beginTransaction();
      await writer.query("UPDATE ims_product_variants SET price_rrp = 99 WHERE variant_id = 'v'");
      await writer.rollback();
      expect(delivered(await sync(request)).products).toEqual([]);
    } finally { writer.release(); }
  });

  it('removes physically deleted variants through a parent foreign-key cascade', async () => {
    const request = await baseline();
    await pool.query("DELETE FROM ims_products WHERE product_id = 'p'");
    expect(delivered(await sync(request)).removed).toEqual(['v']);
  });

  it('refreshes changed promotion dates without requiring a new row update', async () => {
    await pool.query("UPDATE ims_product_variants SET price_rrp_sale=12,discount_start_date='2000-01-01',discount_end_date='2099-01-01' WHERE variant_id='v'");
    const request = await baseline();
    await pool.query('UPDATE pos_catalogue_acknowledgements SET pricing_date = ? WHERE consumer_id = ?', ['2000-01-01', request.consumerId]);
    const delta = delivered(await sync(request));
    expect(delta.products).toMatchObject([{ price: 12, original_price: 20 }]);
  });

  it('keeps consumers independent and fences different locations', async () => {
    const first = await baseline();
    const second = await baseline();
    await pool.query("UPDATE ims_stock SET qty_committed=3 WHERE variant_id='v'");
    await ack(delivered(await sync(first)));
    expect(delivered(await sync(second)).products).toMatchObject([{ available: 7 }]);
    const connection = await pool.getConnection();
    try { await expect(catalogueSync(connection, 'alpha', 2, first)).rejects.toMatchObject({ status: 403 }); }
    finally { connection.release(); }
  });

  it('serializes full rebuilds per business while allowing ordinary deltas', async () => {
    const initialized = await baseline();
    const first = delivered(await sync(consumer()));
    expect(await sync(consumer())).toMatchObject({ mode: 'deferred' });
    const delta = delivered(await sync(initialized));
    expect(delta.mode).toBe('delta');
    await ack(first);
    expect(delivered(await sync(consumer())).mode).toBe('full');
  });

  it('expired lease owners cannot acknowledge a full rebuild', async () => {
    const full = delivered(await sync(consumer()));
    await pool.query("UPDATE pos_catalogue_control SET lease_until = '2000-01-01' WHERE business_id='alpha'");
    await expect(ack(full)).rejects.toMatchObject({ status: 409 });
    expect(delivered(await sync(consumer())).mode).toBe('full');
  });

  it('renews only an unexpired full lease owned by this consumer', async () => {
    const request = consumer();
    const full = delivered(await sync(request));
    expect(await sync({ ...request, renew: full.receipt })).toEqual({ renewed: true });
    await expect(sync({ ...consumer(), renew: full.receipt })).rejects.toMatchObject({ status: 409 });
    await pool.query("UPDATE pos_catalogue_control SET lease_until = '2000-01-01' WHERE business_id='alpha'");
    await expect(sync({ ...request, renew: full.receipt })).rejects.toMatchObject({ status: 409 });
  });

  it('records successful completion rather than snapshot creation as the monthly anchor', async () => {
    const full = delivered(await sync(consumer()));
    await pool.query('DO SLEEP(0.025)');
    const result = await ack(full);
    expect(result).toHaveProperty('completedFullAt');
    if (!('completedFullAt' in result)) throw new Error('Missing completion timestamp.');
    expect(result.completedFullAt).toBeGreaterThan(full.serverTime);
  });

  it('includes legacy full requests in the business-wide rebuild lease', async () => {
    const full = delivered(await sync(consumer()));
    const connection = await pool.getConnection();
    try {
      const work = vi.fn(async () => 'legacy');
      await expect(withLegacyCatalogueLease(connection, 'alpha', work)).rejects.toMatchObject({ status: 503 });
      expect(work).not.toHaveBeenCalled();
      await ack(full);
      expect(await withLegacyCatalogueLease(connection, 'alpha', async () => {
        expect(await sync(consumer())).toMatchObject({ mode: 'deferred' });
        return 'legacy';
      })).toBe('legacy');
      expect(delivered(await sync(consumer())).mode).toBe('full');
    } finally { connection.release(); }
  });

  it('does not reserve a pool connection while projecting a disabled-protocol legacy catalogue', async () => {
    await pool.query("UPDATE ims_settings SET value='no' WHERE `key`='pos_catalogue_sync_v2'");
    const single = mysql.createPool({ host: '127.0.0.1', port, user: 'root', password, database: schema, connectionLimit: 1 });
    try {
      const result = await withLegacyCatalogueLease(single, 'alpha', async () => {
        const [rows] = await single.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM ims_product_variants');
        return Number(rows[0].count);
      });
      expect(result).toBe(1);
    } finally { await single.end(); }
  });

  it('invalidates both identities when a stock row moves to another variant', async () => {
    await pool.query("INSERT INTO ims_product_variants (business_id,variant_id,product_id,price_rrp) VALUES ('alpha','other','p',5)");
    const request = await baseline();
    await pool.query("UPDATE ims_stock SET variant_id='other' WHERE variant_id='v'");
    const delta = delivered(await sync(request));
    expect(delta.products.find(product => product.variant_id === 'v')?.soh).toBe(0);
    expect(delta.products.find(product => product.variant_id === 'other')?.soh).toBe(10);
  });

  it('derives variant ownership from its product for legacy rows with an empty business marker', async () => {
    await pool.query("INSERT INTO ims_product_variants (variant_id,product_id,price_rrp) VALUES ('legacy','p',5)");
    const request = consumer();
    const full = delivered(await sync(request));
    expect(full.products.map(product => product.variant_id)).toContain('legacy');
    await ack(full);
    await pool.query("UPDATE ims_product_variants SET price_rrp=8 WHERE variant_id='legacy'");
    expect(delivered(await sync(request)).products).toMatchObject([{ variant_id: 'legacy', price: 8 }]);
  });

  it('runs the scoped all-tenant migration idempotently without unrelated repairs', async () => {
    await pool.query('CREATE TABLE IF NOT EXISTS businesses (business_id VARCHAR(100), ims_db_name VARCHAR(100), deleted_at DATETIME NULL)');
    await pool.query('DELETE FROM businesses');
    await pool.query('INSERT INTO businesses (business_id, ims_db_name) VALUES (?,?)', ['alpha', schema]);
    const [before] = await pool.query<RowDataPacket[]>('SHOW TABLES');
    const environment = {
      ...process.env, MYSQL_HOST: '127.0.0.1', MYSQL_PORT: String(port), MYSQL_USER: 'root', MYSQL_PASSWORD: password,
      MYSQL_DATABASE: schema, IMS_MYSQL_DATABASE: schema,
    };
    const run = () => promisify(execFile)(process.execPath, [
      path.join(process.cwd(), 'scripts', 'catchup-schema-all-tenants.mjs'), '--pos-catalogue-only', `--schema=${schema}`,
    ], { env: environment });
    expect((await run()).stdout).toContain('rollout remains disabled');
    expect((await run()).stdout).toContain('Done.');
    expect((await pool.query<RowDataPacket[]>('SHOW TABLES'))[0]).toEqual(before);
    const [source] = await pool.query<RowDataPacket[]>("SELECT qty_on_hand FROM ims_stock WHERE variant_id='v'");
    expect(Number(source[0].qty_on_hand)).toBe(10);
    for (const flag of ['--repair=loyalty-collations', '--audit-legacy-stock-avg-cost', '--drop-legacy-stock-avg-cost', '--consignment-only', '--table=ims_stock']) {
      await expect(promisify(execFile)(process.execPath, [
        path.join(process.cwd(), 'scripts', 'catchup-schema-all-tenants.mjs'), '--pos-catalogue-only', flag,
      ], { env: environment })).rejects.toThrow();
    }
  }, 30_000);

  it('removes the last image and returns updated product identity', async () => {
    await pool.query("INSERT INTO ims_product_images (product_id,url,source,is_primary) VALUES ('p','https://cdn.shopify.com/image.png','shopify',1)");
    const request = await baseline();
    await pool.query("DELETE FROM ims_product_images WHERE product_id='p'");
    await pool.query("UPDATE ims_products SET name='Renamed',brand='Brand' WHERE product_id='p'");
    expect(delivered(await sync(request)).products).toMatchObject([{ name: 'Renamed', brand: 'Brand', image_url: null }]);
  });

  it('tracks recipe policy and component stock dependencies', async () => {
    await pool.query("INSERT INTO ims_product_variants (business_id,variant_id,product_id,price_rrp) VALUES ('alpha','component','p',5)");
    await pool.query("INSERT INTO ims_stock (business_id,variant_id,location_id,qty_on_hand) VALUES ('alpha','component',1,20)");
    await pool.query("INSERT INTO ims_product_build_recipes (id,business_id,output_variant_id) VALUES (1,'alpha','v')");
    await pool.query("INSERT INTO ims_product_build_recipe_versions (id,business_id,recipe_id,revision) VALUES (1,'alpha',1,1)");
    await pool.query("INSERT INTO ims_product_build_recipe_components (business_id,recipe_version_id,component_variant_id,quantity_per_output) VALUES ('alpha',1,'component',2)");
    await pool.query('UPDATE ims_product_build_recipes SET active_version_id=1 WHERE id=1');
    await pool.query("INSERT INTO ims_settings (business_id,`key`,value) VALUES ('alpha','builds_enabled','yes'),('alpha','build_from_sale_enabled','yes')");
    const request = await baseline();
    await pool.query("UPDATE ims_stock SET qty_on_hand=12 WHERE variant_id='component'");
    const delta = delivered(await sync(request));
    expect(delta.products.find(p => p.variant_id === 'v')?.buildable_quantity).toBe(6);
    await ack(delta);
    await pool.query("UPDATE ims_settings SET value='no' WHERE `key`='builds_enabled'");
    expect(delivered(await sync(request)).products.find(p => p.variant_id === 'v')?.buildable_quantity).toBe(0);
  });

  it('forces reconciliation of locally patched stock even if its generation was acknowledged', async () => {
    const request = await baseline();
    const response = delivered(await sync({ ...request, refreshIds: ['v'] }));
    expect(response.products).toMatchObject([{ variant_id: 'v', soh: 10 }]);
  });

  it('concurrent full requests cannot acquire two leases', async () => {
    const results = await Promise.all([sync(consumer()), sync(consumer()), sync(consumer())]);
    expect(results.filter(result => 'mode' in result && result.mode === 'full')).toHaveLength(1);
    expect(results.filter(result => 'mode' in result && result.mode === 'deferred')).toHaveLength(2);
  });

  it('measures full versus one-product and empty refreshes with a populated catalogue', async () => {
    const records = Array.from({ length: 1000 }, (_, index) => ['alpha', `bench-${index}`, 'p', `SKU-${index}`, 20]);
    await pool.query(`INSERT INTO ims_product_variants (business_id,variant_id,product_id,sku,price_rrp) VALUES ${records.map(() => '(?,?,?,?,?)').join(',')}`, records.flat());
    const request = consumer();
    const fullStarted = performance.now();
    const full = delivered(await sync(request));
    const fullMs = performance.now() - fullStarted;
    await ack(full);
    await pool.query("UPDATE ims_product_variants SET price_rrp=21 WHERE variant_id='bench-10'");
    const deltaStarted = performance.now();
    const delta = delivered(await sync(request));
    const deltaMs = performance.now() - deltaStarted;
    await ack(delta);
    const empty = delivered(await sync(request));
    const metrics = { variants: full.products.length, fullBytes: JSON.stringify(full).length, deltaBytes: JSON.stringify(delta).length,
      emptyBytes: JSON.stringify(empty).length, fullMs, deltaMs };
    expect(full.products).toHaveLength(1001);
    expect(delta.products).toHaveLength(1);
    expect(empty.products).toHaveLength(0);
    expect(metrics.deltaBytes).toBeLessThan(metrics.fullBytes / 100);
    if (process.env.POS_CATALOGUE_METRICS_FILE) await writeFile(process.env.POS_CATALOGUE_METRICS_FILE, JSON.stringify(metrics, null, 2));
  });
});
