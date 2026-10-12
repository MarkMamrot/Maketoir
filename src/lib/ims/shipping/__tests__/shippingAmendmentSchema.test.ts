import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
    expect(migration).toContain("rows.map(row => row.COLUMN_NAME).join(',') === 'business_id,shipment_id,provider_request_id'");
    expect(migration).toContain("if (!requestedTable || requestedTable === 'ims_shipping_labels') await ensureShippingLabelRequestIndex(schema)");
  });
});
