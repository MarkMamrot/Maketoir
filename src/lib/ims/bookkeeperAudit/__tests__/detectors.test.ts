import { describe, expect, it } from 'vitest';
import { buildCogsAuditFindings, buildDocumentAuditFindings, buildNegativeStockAuditFindings } from '../detectors';
import { applyAuditReviews } from '../presentation';

describe('bookkeeper audit operational detectors', () => {
  it('flags an active SO using the visible 14-day fallback when no expected date exists', () => {
    const findings = buildDocumentAuditFindings([{
      source_type: 'sales_order', source_id: 42, source_reference: 'SO-00042', status: 'confirmed',
      fallback_date: '2026-09-01', explicit_due_date: null, due_rule: 'sales_order_active',
      occurred_at: '2026-09-01T02:00:00.000Z', outstanding_quantity: '3', value_at_risk: '120.00',
    }], '2026-09-16');

    expect(findings).toEqual([expect.objectContaining({
      key: 'sales_order:42:overdue', expected: '2026-09-15', actual: 'confirmed', variance: 3,
      dueDate: { date: '2026-09-15', source: 'assumed', assumedDays: 14 },
    })]);
  });

  it('does not flag an active document until after its due date', () => {
    expect(buildDocumentAuditFindings([{
      source_type: 'purchase_order', source_id: 1, source_reference: 'PO-1', status: 'confirmed',
      fallback_date: '2026-09-01', explicit_due_date: null, due_rule: 'purchase_order_active',
      occurred_at: '2026-09-01T00:00:00.000Z', outstanding_quantity: 2, value_at_risk: 50,
    }], '2026-10-01')).toEqual([]);
  });

  it('flags fractional negative stock and fingerprints quantity changes', () => {
    const base = {
      variant_id: 'v-1', sku: 'SKU-1', product_name: 'Product', location_id: 3, location_name: 'Shop',
      qty_on_hand: '-0.25', unit_cost: '12', updated_at: '2026-09-23T01:00:00.000Z',
    };
    const first = buildNegativeStockAuditFindings([base])[0];
    const changed = buildNegativeStockAuditFindings([{ ...base, qty_on_hand: '-0.5' }])[0];
    expect(first).toMatchObject({ severity: 'warning', actual: -0.25, valueAtRisk: 3 });
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it('accepts only an exact finding fingerprint', () => {
    const finding = buildNegativeStockAuditFindings([{
      variant_id: 'v-1', sku: 'SKU-1', product_name: 'Product', location_id: 3, location_name: 'Shop',
      qty_on_hand: -2, unit_cost: 12, updated_at: '2026-09-23T01:00:00.000Z',
    }])[0];
    const reviews = [{
      id: 9, findingKey: finding.key, fingerprint: finding.fingerprint, reason: 'Count scheduled',
      actorId: '7', actorName: 'Alex', acceptedAt: '2026-09-23 02:00:00.000',
    }];
    expect(applyAuditReviews([finding], reviews)[0].reviewStatus).toBe('accepted');
    expect(applyAuditReviews([{ ...finding, fingerprint: 'f'.repeat(64) }], reviews)[0].reviewStatus).toBe('open');
  });

  it('groups COGS anomalies by source sale and prioritises negative cost', () => {
    const findings = buildCogsAuditFindings([
      { movement_id: 2, source_type: 'sales_order', source_id: 42, source_reference: 'SO-42', sku: 'SKU-RED', product_name: 'Red Shirt', occurred_at: '2026-08-10T00:00:00.000Z', qty_change: -1, unit_cost: null },
      { movement_id: 1, source_type: 'sales_order', source_id: 42, source_reference: 'SO-42', sku: 'SKU-BLUE', product_name: 'Blue Shirt', occurred_at: '2026-08-09T00:00:00.000Z', qty_change: 1, unit_cost: 5 },
    ], '2026-08-31');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      key: 'cogs:sales_order:42:negative', severity: 'critical', variance: 2,
      actual: '1 missing, 0 zero, 1 negative', occurredAt: '2026-08-10T00:00:00.000Z',
      sourceHref: '#sales-orders/42',
    });
    expect(findings[0].summary).toContain('Red Shirt (SKU-RED), Blue Shirt (SKU-BLUE)');
  });
});