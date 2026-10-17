import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const schema = readFileSync(resolve(process.cwd(), 'scripts', 'ims-schema.sql'), 'utf8');
const migration = readFileSync(resolve(process.cwd(), 'scripts', 'catchup-schema-all-tenants.mjs'), 'utf8');
const table = (name: string) => schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\) ENGINE=InnoDB[^;]*;`))?.[0] ?? '';

describe('tenant-safe amendment schema', () => {
  it('adds durable revisions and auditable before/desired/result snapshots', () => {
    expect(table('ims_shipping_shipments')).toMatch(/revision\s+INT NOT NULL DEFAULT 0/);
    expect(table('ims_shipping_labels')).toMatch(/shipment_revision\s+INT NOT NULL DEFAULT 0/);
    const operations = table('ims_shipping_amendments');
    for (const field of ['previous_json', 'desired_json', 'result_json', 'expected_revision', 'request_hash'])
      expect(operations).toContain(field);
    expect(operations).toContain('UNIQUE KEY uq_shipping_amendment_operation (business_id, shipment_id, operation_key)');
    expect(migration).toContain("['ims_shipping_shipments', 'revision', 'INT NOT NULL DEFAULT 0']");
    expect(migration).toContain("['ims_shipping_labels', 'shipment_revision', 'INT NOT NULL DEFAULT 0']");
    expect(migration).toContain('canonicalImsSchema.match(/CREATE TABLE IF NOT EXISTS ims_shipping_amendments');
  });
  it('supports per-shipment shared PDF rows and idempotently corrects the old index for each tenant', () => {
    expect(table('ims_shipping_labels')).toContain('UNIQUE KEY uq_shipping_label_request (business_id, shipment_id, provider_request_id)');
    expect(migration).toContain('information_schema.STATISTICS');
    expect(migration).toMatch(/if \((.+)\) await ensureShippingLabelRequestIndex\(schema\);/);
  });

  it.each([
    [undefined, false, true],
    ['ims_shipping_labels', false, true],
    ['ims_shipping_shipments', false, false],
    [undefined, true, false],
    ['ims_shipping_labels', true, false],
  ])('scopes label-index repair for table %s and consignment mode %s', (requestedTable, consignmentOnly, expected) => {
    const condition = migration.match(/if \((.+)\) await ensureShippingLabelRequestIndex\(schema\);/)?.[1];
    if (!condition) throw new Error('Shipping label index migration guard not found.');
    const shouldMigrate = new Function('requestedTable', 'consignmentOnly', `return (${condition});`);
    expect(shouldMigrate(requestedTable, consignmentOnly)).toBe(expected);
  });

  it.each([
    ['business_id', 'shipment_id', 'provider_request_id'],
    ['business_id', 'provider_request_id', 'shipment_id'],
  ])('preserves an equivalent full-column unique index in order %j', async (...columns) => {
    const query = vi.fn().mockResolvedValueOnce([
      columns.map(COLUMN_NAME => ({ COLUMN_NAME, NON_UNIQUE: 0, SUB_PART: null })),
    ]);
    await runLabelIndexMigration(query);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ COLUMN_NAME: 'business_id', NON_UNIQUE: 0, SUB_PART: null }, { COLUMN_NAME: 'provider_request_id', NON_UNIQUE: 0, SUB_PART: null }],
    ['business_id', 'shipment_id', 'provider_request_id'].map(COLUMN_NAME => ({ COLUMN_NAME, NON_UNIQUE: 1, SUB_PART: null })),
    ['business_id', 'shipment_id', 'provider_request_id'].map(COLUMN_NAME => ({ COLUMN_NAME, NON_UNIQUE: 0, SUB_PART: 10 })),
    [],
  ])('repairs an incompatible label index %#', async (...rows) => {
    const query = vi.fn().mockResolvedValueOnce([rows]).mockResolvedValueOnce([]);
    await runLabelIndexMigration(query);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('ADD UNIQUE INDEX uq_shipping_label_request (business_id, shipment_id, provider_request_id)');
    expect(query.mock.calls[1][0].includes('DROP INDEX')).toBe(rows.length > 0);
  });
});

async function runLabelIndexMigration(query: ReturnType<typeof vi.fn>) {
  const definition = migration.match(/async function ensureShippingLabelRequestIndex\(schema\) \{[\s\S]*?\n\}/)?.[0];
  if (!definition) throw new Error('Shipping label index migration not found.');
  const execute = new Function('conn', `${definition}; return ensureShippingLabelRequestIndex;`)({ query });
  await execute('registered_tenant');
}
