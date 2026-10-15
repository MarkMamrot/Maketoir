import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  run: vi.fn(), getConnection: vi.fn(), query: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: () => ({ getConnection: mocks.getConnection }) }));
import { getAmazonPiiInventory } from '../amazonPiiInventoryRepository';
import { DELIVERY_EVIDENCE_COLUMNS } from '../amazonDeliveryEvidenceRepository';

const schema: Record<string, string[]> = {
  ims_sales_orders: ['id', 'business_id', 'sales_channel', 'customer_id', 'channel_instance_id', 'external_order_id', 'order_date',
    'delivery_address', 'delivery_address2', 'delivery_suburb', 'delivery_city', 'delivery_state', 'delivery_postcode', 'delivery_country', 'notes', 'customer_po_number'],
  ims_contacts: ['id', 'business_id', 'name', 'first_name', 'last_name', 'email', 'phone', 'mobile', 'address', 'address2', 'suburb', 'city', 'state', 'postcode'],
  ims_shipping_shipments: ['id', 'business_id', 'so_id', 'recipient_json'],
  ims_shipping_amendments: ['business_id', 'shipment_id', 'previous_json', 'desired_json', 'result_json'],
  ims_shipping_labels: ['business_id', 'shipment_id', 'label_url'],
  ims_sales_order_items: ['business_id', 'so_id', 'notes'],
  ims_credit_notes: ['id', 'business_id', 'so_id', 'notes', 'reference', 'reversal_reason'],
  ims_credit_note_items: ['cn_id', 'name'],
  ims_sales_channel_events: ['business_id', 'provider', 'channel_instance_id', 'payload_json', 'safe_error'],
  ims_sales_channel_jobs: ['business_id', 'provider', 'channel_instance_id', 'payload_json', 'safe_error'],
  ims_shipping_channel_jobs: ['business_id', 'shipment_id', 'request_json', 'response_json', 'safe_error'],
};
let currentBusiness: string | null;
let missingTables: string[];
let orders: Record<string, unknown>[];

beforeEach(() => {
  vi.clearAllMocks();
  delete schema.ims_amazon_delivery_evidence;
  currentBusiness = null; missingTables = [];
  orders = [{ salesOrderId: 42, amazonOrderReference: '123-1234567-1234567',
    orderDate: '2026-09-15', ageDays: 30, earliestVerifiedDeliveryAt: null, 'order-address': 1, recipient_json: 'must not escape' }];
  mocks.run.mockImplementation(async (businessId: string, callback: () => Promise<unknown>) => {
    currentBusiness = businessId;
    try { return await callback(); } finally { currentBusiness = null; }
  });
  mocks.getConnection.mockImplementation(async () => {
    expect(currentBusiness).toBe('tenant-a');
    return { query: mocks.query, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release };
  });
  mocks.commit.mockResolvedValue(undefined);
  mocks.rollback.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (sql: string) => {
    expect(currentBusiness).toBe('tenant-a');
    if (sql.includes('information_schema.COLUMNS')) return [Object.entries(schema)
      .filter(([table]) => !missingTables.includes(table))
      .flatMap(([TABLE_NAME, columns]) => columns.map(COLUMN_NAME => ({ TABLE_NAME, COLUMN_NAME }))), []];
    if (sql.includes('AS amazonOrders')) return [[{ amazonOrders: '1', ordersWithPotentialPii: '1',
      ordersWithStructuredFields: '1', ordersWithUnreviewedContent: '0', agedOrdersNeedingReview: '1',
      ordersWithVerifiedDelivery: '1', ordersPastReviewDeadline: '1' }], []];
    if (sql.includes('AS salesOrderId')) return [orders, []];
    return [[{ records: '2' }], []];
  });
});

describe('tenant-safe Amazon PII inventory reads', () => {
  it('uses earliest active delivery and exact UTC timing for review, not fulfilment or age', async () => {
    schema.ims_amazon_delivery_evidence = DELIVERY_EVIDENCE_COLUMNS;
    orders = [{ ...orders[0], orderDate: '2025-09-01', ageDays: 30, earliestVerifiedDeliveryAt: '2025-09-01T00:00:00.000000Z' }];
    const report = await getAmazonPiiInventory({ businessId: 'tenant-a', now: new Date('2025-10-01T00:00:00Z') });
    expect(report.deliveryEvidence).toEqual({ availability: 'available', ordersWithVerifiedDelivery: 1, ordersPastReviewDeadline: 1 });
    expect(report.orders[0]).toMatchObject({ earliestVerifiedDeliveryAt: '2025-09-01T00:00:00.000Z', reviewDeadlineAt: '2025-10-01T00:00:00.000Z' });
    expect(report.summary.confirmedOverdue).toBeNull();
    const summary = mocks.query.mock.calls.find(([sql]) => sql.includes('AS amazonOrders'))!;
    expect(summary[0]).toContain('MIN(d.delivered_at)');
    expect(summary[0]).toContain("v.kind = 'void'");
    expect(summary[0]).toContain('v.business_id = d.business_id');
    expect(summary[0]).toContain('<= DATE_SUB(?, INTERVAL 30 DAY)');
    expect(summary[1]).toEqual(['2025-10-01', 30, '2025-10-01 00:00:00.000', 'tenant-a']);
  });
  it('uses a read-only consistent snapshot, tenant predicates and safe whitelisted output', async () => {
    const report = await getAmazonPiiInventory({ businessId: 'tenant-a', now: new Date('2026-10-15T00:00:00Z') });
    expect(mocks.run).toHaveBeenCalledWith('tenant-a', expect.any(Function));
    expect(mocks.query).toHaveBeenCalledWith('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    expect(report.summary).toMatchObject({ amazonOrders: 1, agedOrdersNeedingReview: 1, confirmedOverdue: null });
    expect(report.deliveryEvidence).toEqual({ availability: 'unavailable', ordersWithVerifiedDelivery: null, ordersPastReviewDeadline: null });
    expect(report.orders[0]).toEqual({ salesOrderId: 42, amazonOrderReference: '123-1234567-1234567',
      orderDate: '2026-09-15', ageDays: 30, sourceIds: ['order-address'], earliestVerifiedDeliveryAt: null, reviewDeadlineAt: null });
    for (const [sql, params] of mocks.query.mock.calls) {
      expect(sql).toMatch(/^(SELECT|SET TRANSACTION|START TRANSACTION)/);
      if (sql.includes('AS records') || sql.includes('AS salesOrderId') || sql.includes('AS amazonOrders')) {
        expect(sql).toContain('business_id = ?');
        expect(params).toContain('tenant-a');
      }
    }
    expect(mocks.query.mock.calls.find(([sql]) => sql.includes('AS amazonOrders'))?.[1]).toEqual(['2026-10-15', 30, 'tenant-a']);
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(report)).not.toContain('must not escape');
  });

  it('marks missing sources unavailable without querying absent tables or treating them as zero', async () => {
    missingTables = ['ims_contacts', 'ims_shipping_shipments'];
    const report = await getAmazonPiiInventory({ businessId: 'tenant-a' });
    expect(report.sources.filter(source => source.availability === 'unavailable').map(source => source.id))
      .toEqual(['linked-contact', 'shipment-recipient', 'shipment-amendment', 'shipping-label', 'shipping-job']);
    expect(report.sources.find(source => source.id === 'linked-contact')?.records).toBeNull();
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('FROM ims_contacts t'))).toBe(false);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('FROM ims_shipping_shipments s'))).toBe(false);
  });

  it('counts unlinked Amazon payloads but scopes order-linked events by seller instance and tenant', async () => {
    await getAmazonPiiInventory({ businessId: 'tenant-a' });
    const events = mocks.query.mock.calls.find(([sql]) => sql.includes('AS records FROM ims_sales_channel_events'));
    expect(events?.[0]).not.toContain('JOIN ims_sales_orders');
    expect(events?.[0]).toContain("t.provider = 'amazon'");
    const page = mocks.query.mock.calls.find(([sql]) => sql.includes('AS salesOrderId'))?.[0];
    expect(page).toContain('t.channel_instance_id = o.channel_instance_id');
    expect(page).toContain('t.business_id = o.business_id');
    expect(page).not.toContain('deliveredAt');
    expect(page).not.toContain('fulfilled_date');
  });

  it('paginates without truncating the aggregate inventory or returning more than 25 orders', async () => {
    orders = Array.from({ length: 26 }, (_, index) => ({ ...orders[0], salesOrderId: index + 101 }));
    const report = await getAmazonPiiInventory({ businessId: 'tenant-a', afterId: 100 });
    expect(report.orders).toHaveLength(25);
    expect(report.nextAfterId).toBe(125);
    expect(report.afterId).toBe(100);
    expect(mocks.query.mock.calls.find(([sql]) => sql.includes('AS salesOrderId'))?.[1])
      .toEqual([expect.any(String), 'tenant-a', 100, 26]);
  });

  it.each(['schema', 'query', 'commit'])('surfaces %s failures and releases the connection', async failure => {
    if (failure === 'schema') missingTables = ['ims_sales_orders'];
    if (failure === 'query') mocks.query.mockRejectedValueOnce(new Error('query failed'));
    if (failure === 'commit') mocks.commit.mockRejectedValueOnce(new Error('commit failed'));
    await expect(getAmazonPiiInventory({ businessId: 'tenant-a' })).rejects.toThrow();
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
