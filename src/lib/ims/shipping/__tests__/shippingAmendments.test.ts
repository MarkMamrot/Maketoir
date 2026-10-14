import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AusPostApiError } from '../carriers/auspostEparcel/client';
import { amendShippingShipment, carrierReadbackMatches, getShippingEditableDetail, reconcileShippingAmendment } from '../shippingAmendments';
import type { ShippingAmendmentInput } from '../shippingAmendmentTypes';

const mocks = vi.hoisted(() => ({
  pool: vi.fn(), order: vi.fn(), prepare: vi.fn(), quotes: vi.fn(), read: vi.fn(), update: vi.fn(),
  labels: vi.fn(), runtime: vi.fn(), credentials: vi.fn(),
  name: vi.fn(),
}));
vi.mock('../shippingCustomerNames', async importOriginal => ({
  ...await importOriginal<typeof import('../shippingCustomerNames')>(), resolveShippingOrderCustomerName: mocks.name,
}));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mocks.pool }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsSORepo: { get: mocks.order } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.runtime }));
vi.mock('../shippingDrafts', async importOriginal => ({
  ...await importOriginal<typeof import('../shippingDrafts')>(), prepareShippingRequest: mocks.prepare,
}));
vi.mock('../shippingQuotes', () => ({ quotePreparedShippingRequest: mocks.quotes }));
vi.mock('../shippingSettingsRepository', () => ({ ShippingSettingsRepository: { getAccountCredentials: mocks.credentials } }));
vi.mock('../shippingLabelRevisions', () => ({ supersedeShippingLabels: mocks.labels }));
vi.mock('../carriers/auspostEparcel/client', async importOriginal => ({
  ...await importOriginal<typeof import('../carriers/auspostEparcel/client')>(),
  AusPostEparcelClient: class { getShipment = mocks.read; updateShipment = mocks.update; },
}));

const recipient = { name: 'Buyer', lines: ['2 High St'], suburb: 'Sydney', state: 'NSW', postcode: '2000', country: 'AU', email: '', phone: '' };
const sender = { name: 'Store', lines: ['1 Main St'], suburb: 'Melbourne', state: 'VIC', postcode: '3000', country: 'AU', phone: '' };
const service = { serviceCode: 'T28', serviceName: 'Parcel Post', total: 11, totalExGst: 10, gst: 1 };
const parcel = { parcelId: 12, providerItemId: null as string | null, packagePresetId: null, packageType: 'box', parcelNumber: 1,
  lengthMm: 200, widthMm: 100, heightMm: 100, weightKg: 1, allocations: [{ soItemId: 5, quantity: 2 }] };
let state: {
  shipment: Record<string, any>; order: Record<string, any>; items: Record<string, any>[];
  parcels: Record<string, any>[]; allocations: Record<string, any>[]; operation?: Record<string, any>;
};
let log: string[];
let snapshot: typeof state;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.name.mockImplementation(async (_businessId: string, _soId: number, name: string) => ({
    name: name === 'Online Customer' ? 'Order Recipient' : name, issue: null,
  }));
  vi.stubEnv('AUSPOST_DOMESTIC_AMENDMENTS_VERIFIED', 'true');
  state = {
    shipment: { id: 1, so_id: 10, business_id: 'tenant-1', revision: 0, updated_at: '2026-10-12T01:00:00Z', status: 'draft',
      provider: 'auspost_eparcel', carrier_account_id: 9, provider_shipment_id: null, provider_reference: 'SO-10-source',
      is_international: 0, recipient_json: recipient, sender_json: sender, customs_json: null,
      service_code: 'T28', service_name: 'Parcel Post', quoted_cost: 11, quoted_cost_ex_gst: 10, quoted_gst: 1 },
    order: { id: 10, business_id: 'tenant-1', so_number: 'SO-10', status: 'confirmed', so_type: 'online', customer_name: 'Buyer',
      tax_treatment: 'inc_tax', delivery_address: '2 High St', delivery_suburb: 'Sydney', delivery_state: 'NSW', delivery_postcode: '2000', delivery_country: 'AU' },
    items: [{ id: 5, so_id: 10, business_id: 'tenant-1', sku: 'SKU', product_name: 'Product', qty_ordered: 2, qty_fulfilled: 0, unit_price: 22 }],
    parcels: [{ id: 12, parcel_number: 1, package_type: 'box', length_mm: 200, width_mm: 100, height_mm: 100, weight_kg: 1, provider_item_id: null }],
    allocations: [{ parcel_id: 12, so_item_id: 5, quantity: 2 }],
  };
  log = [];
  const connection = {
    beginTransaction: vi.fn(async () => { log.push('BEGIN'); snapshot = clone(state); }),
    commit: vi.fn(async () => { log.push('COMMIT'); }),
    rollback: vi.fn(async () => { log.push('ROLLBACK'); if (snapshot) state = clone(snapshot); }),
    release: vi.fn(),
    execute: vi.fn(async (raw: string, p: any[]) => {
      const sql = raw.replace(/\s+/g, ' ').trim();
      log.push(sql);
      if (sql.startsWith('SELECT * FROM ims_shipping_shipments')) return [p[0] === state.shipment.business_id && p[1] === 1 ? [clone(state.shipment)] : []];
      if (sql.startsWith('SELECT batch_key FROM ims_shipping_batch_memberships')) return [[{ batch_key: state.shipment.batch_key ?? null }]];
      if (sql.startsWith('SELECT * FROM ims_shipping_parcels') || sql.startsWith('SELECT id FROM ims_shipping_parcels')) return [clone(state.parcels)];
      if (sql.startsWith('SELECT i.*')) return [clone(state.allocations)];
      if (sql.startsWith('SELECT * FROM ims_sales_orders')) return [[clone(state.order)]];
      if (sql.startsWith('SELECT * FROM ims_sales_order_items')) return [clone(state.items)];
      if (sql.startsWith('SELECT * FROM ims_shipping_amendments')) return [state.operation ? [clone(state.operation)] : []];
      if (sql.startsWith('INSERT INTO ims_shipping_amendments')) {
        state.operation = { id: 101, shipment_id: p[1], operation_key: p[2], request_hash: p[3], expected_revision: p[4],
          status: 'claimed', previous_json: p[5], desired_json: p[6], updated_at: '2026-10-12T01:00:00Z' };
        return [{ insertId: 101 }];
      }
      if (sql.startsWith('UPDATE ims_shipping_shipments SET revision')) { state.shipment.revision++; return [{}]; }
      if (sql.startsWith("UPDATE ims_shipping_shipments SET status = 'amending'")) { state.shipment.status = 'amending'; return [{}]; }
      if (sql.startsWith('UPDATE ims_shipping_amendments SET desired_json')) { state.operation!.desired_json = p[0]; return [{}]; }
      if (sql.startsWith("UPDATE ims_shipping_amendments SET status = 'confirmed'")) {
        state.operation!.status = 'confirmed'; state.operation!.result_json = p[0]; return [{}];
      }
      if (sql.startsWith('UPDATE ims_shipping_amendments SET status = ?')) { state.operation!.status = p[0]; return [{}]; }
      if (sql.startsWith('UPDATE ims_shipping_shipments SET status = ?')) { state.shipment.status = p[0]; return [{}]; }
      if (sql.startsWith('UPDATE ims_shipping_shipments SET carrier_account_id')) {
        Object.assign(state.shipment, { carrier_account_id: p[0], status: p[3], service_code: p[4], service_name: p[5],
          recipient_json: p[10], customs_json: p[14] }); return [{}];
      }
      if (sql.startsWith('UPDATE ims_sales_orders SET delivery_address')) {
        Object.assign(state.order, { delivery_address: p[0], delivery_address2: p[1], delivery_suburb: p[2], delivery_city: p[3],
          delivery_state: p[4], delivery_postcode: p[5], delivery_country: p[6] }); return [{}];
      }
      if (sql.startsWith('DELETE FROM ims_shipping_parcel_items')) { state.allocations = []; return [{}]; }
      if (sql.startsWith('DELETE FROM ims_shipping_parcels')) { state.parcels = state.parcels.filter(parcel => parcel.id !== p[2]); return [{}]; }
      if (sql.startsWith('INSERT INTO ims_shipping_parcels')) {
        const id = 13 + state.parcels.length;
        state.parcels.push({ id, package_preset_id: p[0], parcel_number: p[1], package_type: p[2],
          length_mm: p[3], width_mm: p[4], height_mm: p[5], weight_kg: p[6], provider_item_id: null });
        return [{ insertId: id }];
      }
      if (sql.startsWith('INSERT INTO ims_shipping_parcel_items')) {
        state.allocations.push({ parcel_id: p[1], so_item_id: p[2], quantity: p[3] }); return [{}];
      }
      if (sql.startsWith('UPDATE ims_shipping_parcels SET package_preset_id')) {
        Object.assign(state.parcels.find(parcel => parcel.id === p[9])!, { parcel_number: p[1], length_mm: p[3], width_mm: p[4], height_mm: p[5], weight_kg: p[6] }); return [{}];
      }
      if (sql.startsWith('UPDATE ims_shipping_shipments SET charged_cost')) { state.shipment.charged_cost = p[0]; return [{}]; }
      if (sql.startsWith('UPDATE ims_shipping_parcels')) return [{}];
      throw new Error(`Unexpected SQL in test: ${sql}`);
    }),
  };
  mocks.pool.mockReturnValue({ getConnection: async () => connection });
  mocks.order.mockImplementation(async () => ({ ...clone(state.order), items: clone(state.items) }));
  mocks.prepare.mockImplementation(async (input: any) => ({
    account: { id: 9, provider: 'auspost_eparcel', dispatchLocationId: 3 },
    entries: [{ requested: input.shipments[0], order: { ...clone(state.order), items: clone(state.items) }, dispatchLocationId: 3,
      sender, recipient: input.shipments[0].recipient, isInternational: false, customs: null }],
  }));
  mocks.quotes.mockResolvedValue([{ soId: 10, rates: [service] }]);
  mocks.credentials.mockResolvedValue({ apiKey: 'test', password: 'test', accountNumber: 'test' });
  mocks.labels.mockImplementation(async () => { log.push('SUPERSEDE'); return [1, 2]; });
  mocks.update.mockImplementation(async (_id: string, body: any) => {
    log.push('CARRIER PUT');
    mocks.read.mockResolvedValue({ ...clone(body), shipment_id: 'carrier-1', status: 'Created' });
    return { shipments: [{ shipment_id: 'carrier-1' }] };
  });
});
afterEach(() => vi.unstubAllEnvs());
function input(): ShippingAmendmentInput {
  return { carrierAccountId: 9, recipient: { ...recipient, lines: ['3 New St'] }, parcels: [{ ...parcel, providerItemId: state.parcels[0].provider_item_id }],
    expectedRevision: 0, expectedUpdatedAt: '2026-10-12T01:00:00Z', operationKey: 'edit-1', service, confirmCarrierUpdate: true };
}
function carrier() {
  state.shipment.provider_shipment_id = 'carrier-1'; state.shipment.status = 'label_ready';
  state.parcels[0].provider_item_id = 'item-12';
  mocks.read.mockResolvedValue({ shipment_id: 'carrier-1', shipment_reference: 'SO-10-source', customer_reference_1: 'SO-10',
    sender_references: ['SO-10'], options: { email_tracking_enabled: false }, contains_s8_goods: false,
    movement_type: 'DESPATCH', charge_to_account: 'test-account',
    shipment_summary: { total_cost: 12.43, total_cost_ex_gst: 11.3, total_gst: 1.13, status: 'Created', number_of_items: 1 },
    from: sender, to: recipient,
    items: [{ item_id: 'item-12', item_reference: 'SO-10-P1', product_id: 'T28', length: 20, width: 10, height: 10, weight: 1,
      contains_dangerous_goods: false, authority_to_leave: false, safe_drop_enabled: true, allow_partial_delivery: true,
      item_contents: [], item_summary: {}, label: {}, postage_details: {}, tracking_details: { article_id: 'article-12' } }] });
}
describe('shipping amendments', () => {
  it('reuses the borrowed connection for order reads when concurrent details fill the pool', async () => {
    const pool = mocks.pool();
    const connection = await pool.getConnection();
    let borrowed = 0;
    let acquisitions = 0;
    pool.getConnection = vi.fn(async () => {
      if (borrowed >= 5) throw new Error('Nested acquisition exhausted the tenant pool');
      borrowed++;
      acquisitions++;
      return connection;
    });
    connection.release.mockImplementation(() => { borrowed--; });
    mocks.order.mockImplementation(async (_id, _businessId, suppliedConnection) => {
      if (!suppliedConnection) await pool.getConnection();
      expect(suppliedConnection).toBe(connection);
      expect(borrowed).toBeGreaterThan(0);
      return { ...clone(state.order), items: clone(state.items) };
    });

    const details = await Promise.all(
      Array.from({ length: 5 }, () => getShippingEditableDetail('tenant-1', 1)),
    );

    expect(details).toHaveLength(5);
    expect(acquisitions).toBe(5);
    expect(borrowed).toBe(0);
  });

  it('suggests the real recipient in the editor without rewriting a purchased shipment or labels', async () => {
    carrier();
    state.shipment.recipient_json = { ...recipient, name: 'Online Customer' };
    state.order.customer_name = 'Online Customer';
    const before = clone(state);
    const detail = await getShippingEditableDetail('tenant-1', 1);
    expect(detail.order.customer_name).toBe('Order Recipient');
    expect(detail.suggestedRecipientName).toBe('Order Recipient');
    expect(detail.recipient.name).toBe('Online Customer');
    expect(state).toEqual(before);
    expect(log.some(sql => sql.startsWith('UPDATE') || sql.startsWith('INSERT'))).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.labels).not.toHaveBeenCalled();
  });
  it('uses the saved recipient in amendment results even when the shared contact remains generic', async () => {
    state.order.customer_name = 'Online Customer';
    const connection = await mocks.pool().getConnection();
    const result = await amendShippingShipment('tenant-1', 1, input());
    expect(result.shipment.order.customer_name).toBe('Buyer');
    expect(state.order.customer_name).toBe('Online Customer');
    expect(mocks.order.mock.calls.every(call => call[2] === connection)).toBe(true);
  });
  it('saves unbatched measurements without pricing or changing the Sales Order address', async () => {
    const beforeOrder = clone(state.order);
    const result = await amendShippingShipment('tenant-1', 1, { ...input(), preparationOnly: true, service: null });
    expect(result.shipment.revision).toBe(1);
    expect(result.shipment.service).toBeNull();
    expect(state.order).toEqual(beforeOrder);
    expect(mocks.quotes).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.labels).not.toHaveBeenCalled();
  });
  it('refuses a measurement-only update once the preparation joins a batch', async () => {
    state.shipment.batch_key = 'batch-1';
    await expect(amendShippingShipment('tenant-1', 1, { ...input(), preparationOnly: true, service: null })).rejects.toMatchObject({ status: 409 });
    expect(state.shipment.revision).toBe(0);
    expect(log).toContain('ROLLBACK');
  });
  it('does not allow measurement-only saves to bypass carrier amendment review', async () => {
    carrier();
    await expect(amendShippingShipment('tenant-1', 1, { ...input(), preparationOnly: true, service: null })).rejects.toMatchObject({ status: 409 });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('saves a local draft address and parcel details atomically without stock or carrier writes', async () => {
    const beforeItems = clone(state.items);
    const result = await amendShippingShipment('tenant-1', 1, input());
    expect(result.shipment.recipient.lines).toEqual(['3 New St']);
    expect(result.shipment.order.delivery_address).toBe('3 New St');
    expect(state.order.delivery_address).toBe('3 New St');
    expect(state.items).toEqual(beforeItems);
    expect(result.shipment.revision).toBe(1);
    expect(result.requiresFreshLabels).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.labels).not.toHaveBeenCalled();
    expect(log.some(sql => /stock|UPDATE ims_sales_order_items/i.test(sql))).toBe(false);
  });
  it('replays confirmed identical operations and refuses changed idempotency hashes', async () => {
    const body = input();
    const result = await amendShippingShipment('tenant-1', 1, body);
    await expect(amendShippingShipment('tenant-1', 1, body)).resolves.toEqual(result);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    await expect(amendShippingShipment('tenant-1', 1, { ...body, recipient: { ...body.recipient, lines: ['Different'] } })).rejects.toThrow(/already used/);
  });
  it('allows local drafts to remove/add parcels and change carrier account without creating carrier identities', async () => {
    const body = input();
    body.carrierAccountId = 11;
    body.parcels = [{ ...body.parcels[0], parcelId: undefined, providerItemId: undefined }];
    const result = await amendShippingShipment('tenant-1', 1, body);
    expect(result.shipment.carrierAccountId).toBe(11);
    expect(result.shipment.parcels).toHaveLength(1);
    expect(result.shipment.parcels[0].parcelId).not.toBe(12);
    expect(result.shipment.parcels[0].providerItemId).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('rolls back the claim if shared PDF siblings are not editable, before any remote mutation', async () => {
    carrier();
    mocks.labels.mockRejectedValue(new Error('A shared label PDF includes a dispatched or manifested shipment.'));
    await expect(amendShippingShipment('tenant-1', 1, input())).rejects.toMatchObject({ status: 409 });
    expect(state.shipment.revision).toBe(0);
    expect(state.shipment.status).toBe('label_ready');
    expect(state.operation).toBeUndefined();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('enforces tenant ownership before returning details or making carrier calls', async () => {
    await expect(getShippingEditableDetail('wrong-tenant', 1)).rejects.toMatchObject({ status: 404 });
    await expect(amendShippingShipment('wrong-tenant', 1, input())).rejects.toMatchObject({ status: 404 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('refuses stale revision and changed quotes before carrier writes', async () => {
    carrier();
    await expect(amendShippingShipment('tenant-1', 1, { ...input(), expectedRevision: 5 })).rejects.toMatchObject({ status: 409 });
    mocks.quotes.mockResolvedValue([{ soId: 10, rates: [{ ...service, total: 12 }] }]);
    await expect(amendShippingShipment('tenant-1', 1, input())).rejects.toMatchObject({ status: 409 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('invalidates shared labels in the claim transaction then preserves carrier shipment/item IDs and options', async () => {
    carrier();
    const result = await amendShippingShipment('tenant-1', 1, input());
    const supersedeIndex = log.indexOf('SUPERSEDE');
    const putIndex = log.indexOf('CARRIER PUT');
    expect(supersedeIndex).toBeGreaterThan(0);
    expect(log.slice(supersedeIndex, putIndex)).toContain('COMMIT');
    expect(mocks.labels).toHaveBeenCalledTimes(1);
    expect(result.affectedShipmentIds).toEqual([1, 2]);
    expect(result.requiresFreshLabels).toBe(true);
    expect(result.shipment.status).toBe('carrier_created');
    expect(result.shipment.providerShipmentId).toBe('carrier-1');
    expect(mocks.update.mock.calls[0][0]).toBe('carrier-1');
    expect(mocks.update.mock.calls[0][1]).toMatchObject({
      shipment_reference: 'SO-10-source', customer_reference_1: 'SO-10',
      sender_references: ['SO-10'], options: { email_tracking_enabled: false }, contains_s8_goods: false,
      movement_type: 'DESPATCH', charge_to_account: 'test-account',
      items: [{ item_id: 'item-12', item_reference: 'SO-10-P1', authority_to_leave: false, allow_partial_delivery: true,
        contains_dangerous_goods: false, safe_drop_enabled: true, item_contents: [] }],
    });
    expect(JSON.parse(state.operation!.previous_json).shipment.status).toBe('label_ready');
  });
  it('keeps previous details on definitive rejection, but never restores superseded label_ready', async () => {
    carrier();
    mocks.update.mockRejectedValue(new AusPostApiError('Rejected', 400, []));
    await expect(amendShippingShipment('tenant-1', 1, input())).rejects.toMatchObject({ status: 400, requiresFreshLabels: true, affectedShipmentIds: [1, 2] });
    expect(state.shipment.status).toBe('carrier_created');
    expect(state.shipment.revision).toBe(1);
    expect(state.operation!.status).toBe('rejected');
    expect(state.order.delivery_address).toBe('2 High St');
    expect(mocks.runtime).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'tenant-1', reference: { type: 'shipping_shipment', id: 1 } }));
  });
  it('does not mistake a readback404 after accepted PUT for definitive rejection', async () => {
    carrier();
    mocks.update.mockImplementation(async () => {
      mocks.read.mockRejectedValue(new AusPostApiError('Readback unavailable', 404, []));
      return { shipments: [{ shipment_id: 'carrier-1' }] };
    });
    await expect(amendShippingShipment('tenant-1', 1, input())).rejects.toMatchObject({ status: 409, requiresFreshLabels: true });
    expect(state.shipment.status).toBe('amendment_unknown');
    expect(state.operation!.status).toBe('unknown');
    expect(state.order.delivery_address).toBe('2 High St');
  });
  it('keeps the actual recorded carrier charge separate from the service quote', async () => {
    carrier();
    mocks.update.mockImplementation(async (_id: string, body: any) => {
      mocks.read.mockResolvedValue({
        ...clone(body), shipment_id: 'carrier-1', shipment_summary: { status: 'Created', total_cost: 12.43, total_gst: 1.13 },
      });
      return { shipments: [{ shipment_id: 'carrier-1' }] };
    });
    const result = await amendShippingShipment('tenant-1', 1, input());
    expect(result.shipment.service?.total).toBe(11);
    expect(result.shipment.chargedCost).toBe(12.43);
  });
  it('accepts the verified Created-in-summary GET shape and preserves empty root options', async () => {
    carrier();
    const remote = await mocks.read();
    delete remote.status;
    remote.options = {};
    mocks.read.mockResolvedValue(remote);
    mocks.update.mockImplementation(async (_id: string, body: any) => {
      mocks.read.mockResolvedValue({
        ...clone(body), shipment_id: 'carrier-1', shipment_summary: { status: 'Created', total_cost: 12.43, total_gst: 1.13 },
      });
      return { shipments: [{ shipment_id: 'carrier-1' }] };
    });
    const result = await amendShippingShipment('tenant-1', 1, input());
    expect(result.shipment.status).toBe('carrier_created');
    expect(mocks.update.mock.calls[0][1].options).toEqual({});
    expect(mocks.update.mock.calls[0][1].items[0].safe_drop_enabled).toBe(true);
    expect(mocks.update.mock.calls[0][1].items[0]).not.toHaveProperty('label');
    expect(mocks.update.mock.calls[0][1].items[0]).not.toHaveProperty('tracking_details');
  });
  it.each([new Error('timeout'), new AusPostApiError('Conflict', 409, []), new AusPostApiError('Rate limit', 429, [])])('persists unknown outcomes and never blindly replays %s', async error => {
    carrier();
    mocks.update.mockRejectedValue(error);
    const body = input();
    await expect(amendShippingShipment('tenant-1', 1, body)).rejects.toMatchObject({ status: 409 });
    expect(state.shipment.status).toBe('amendment_unknown');
    expect(state.operation!.status).toBe('unknown');
    expect(state.order.delivery_address).toBe('2 High St');
    await expect(amendShippingShipment('tenant-1', 1, body)).rejects.toThrow(/no carrier update was replayed/);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await expect(reconcileShippingAmendment('tenant-1', 1)).rejects.toMatchObject({ status: 409 });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const desired = JSON.parse(state.operation!.desired_json);
    mocks.read.mockResolvedValue({ ...desired.remoteRequest, shipment_id: 'carrier-1', status: 'Created' });
    const result = await reconcileShippingAmendment('tenant-1', 1);
    expect(result.affectedShipmentIds).toEqual([1, 2]);
    expect(result.shipment.status).toBe('carrier_created');
    expect(state.order.delivery_address).toBe('3 New St');
    expect(state.operation!.status).toBe('confirmed');
    expect(mocks.labels).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it('rejects a changed item identity, missing readback fields and a manifested readback', async () => {
    carrier();
    const remote = await mocks.read();
    const desired = { ...remote, items: remote.items } as any;
    expect(carrierReadbackMatches({ ...remote, items: [{ ...remote.items[0], item_id: 'replacement' }] }, desired, 'carrier-1')).toBe(false);
    expect(carrierReadbackMatches({ ...remote, to: undefined }, desired, 'carrier-1')).toBe(false);
    expect(carrierReadbackMatches({ ...remote, order_id: 'booked' }, desired, 'carrier-1')).toBe(false);
    expect(carrierReadbackMatches({ ...remote, status: 'Initiated' }, desired, 'carrier-1')).toBe(false);
    expect(carrierReadbackMatches({ ...remote, status: 'Sealed' }, desired, 'carrier-1')).toBe(false);
    expect(carrierReadbackMatches({ ...remote, status: undefined }, desired, 'carrier-1')).toBe(true);
    expect(carrierReadbackMatches({ ...remote, shipment_summary: {} }, desired, 'carrier-1')).toBe(false);
    expect(carrierReadbackMatches({ ...remote, shipment_summary: { status: 'Created', order_id: 'booked' } }, desired, 'carrier-1')).toBe(false);
    expect(carrierReadbackMatches({ ...remote, options: {} }, desired, 'carrier-1')).toBe(false);
    expect(carrierReadbackMatches({ ...remote, items: [{ ...remote.items[0], safe_drop_enabled: false }] }, desired, 'carrier-1')).toBe(false);
  });
});
