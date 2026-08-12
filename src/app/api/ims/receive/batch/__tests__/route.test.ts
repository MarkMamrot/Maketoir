import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const {
  mockGetImsSession,
  mockTriggerPOXeroSync,
  mockRefreshVariantCache,
  mockGetConnection,
  mockReportRuntimeIssue,
} = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockTriggerPOXeroSync: vi.fn(),
  mockRefreshVariantCache: vi.fn(),
  mockGetConnection: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({
  getImsSession: mockGetImsSession,
}));

vi.mock('@/lib/ims/xeroHooks', () => ({
  triggerPOXeroSync: mockTriggerPOXeroSync,
}));

vi.mock('@/lib/ims/cacheHelper', () => ({
  refreshVariantCache: mockRefreshVariantCache,
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ getConnection: mockGetConnection }),
}));

vi.mock('@/lib/runtimeIssues', () => ({
  reportRuntimeIssue: mockReportRuntimeIssue,
}));

import { POST } from '../route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/ims/receive/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildFakeConnection(state: {
  po: Row;
  settings: Row[];
  items: Row[];
  stockByVariant: Map<string, Row>;
  landedRows: Row[];
  paymentAgg: Row;
  movements: Row[];
  variantAvgById: Map<string, number>;
}) {
  const beginTransaction = vi.fn(async () => {});
  const commit = vi.fn(async () => {});
  const rollback = vi.fn(async () => {});
  const release = vi.fn(() => {});
  const receiveOperations = new Map<string, Row>();

  const execute = vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (s.startsWith('insert ignore into ims_po_receive_operations')) {
      const [businessId, operationKey, requestHash, poId] = params;
      const key = `${businessId}|${operationKey}`;
      if (!receiveOperations.has(key)) receiveOperations.set(key, { request_hash: requestHash, po_id: poId, status: 'processing', response_json: null });
      return [{ affectedRows: 1 }];
    }

    if (s.includes('from ims_po_receive_operations') && s.includes('for update')) {
      const [businessId, operationKey] = params;
      return [[receiveOperations.get(`${businessId}|${operationKey}`)]];
    }

    if (s.startsWith("update ims_po_receive_operations set status = 'complete'")) {
      const [responseJson, businessId, operationKey] = params;
      const operation = receiveOperations.get(`${businessId}|${operationKey}`);
      if (operation) Object.assign(operation, { status: 'complete', response_json: responseJson });
      return [{ affectedRows: operation ? 1 : 0 }];
    }

    if (s.includes('from ims_purchase_orders where id = ? for update')) {
      return [[state.po]];
    }

    if (s.startsWith('select * from ims_purchase_orders where id = ?')) {
      return [[state.po]];
    }

    if (s.includes('from ims_settings') && s.includes('freight_treatment') && s.includes('landed_cost_treatment')) {
      return [state.settings];
    }

    if (s.includes('from ims_purchase_order_items') && s.includes('for update')) {
      return [state.items.map((i) => ({ ...i }))];
    }

    if (s.includes('select amount from ims_po_landed_costs')) {
      return [state.landedRows];
    }

    if (s.includes('sum(amount) as tot_foreign') && s.includes('ims_purchase_order_payments')) {
      return [[state.paymentAgg]];
    }

    if (s.startsWith('update ims_purchase_order_items set qty_received = qty_received + ?')) {
      const [delta, poId, variantId] = params;
      const row = state.items.find((i) => i.po_id === poId && i.variant_id === variantId);
      if (row) row.qty_received = Number(row.qty_received) + Number(delta);
      return [{ affectedRows: row ? 1 : 0 }];
    }

    // Phase 2: org-level state query (variant avg + total org qty)
    if (s.includes('from ims_product_variants pv') && s.includes('left join ims_stock s') && s.includes('total_org_qty')) {
      const [variantId] = params;
      let totalOrgQty = 0;
      for (const row of state.stockByVariant.values()) {
        if (row.variant_id === variantId) totalOrgQty += Number(row.qty_on_hand ?? 0);
      }
      return [[{ variant_avg: state.variantAvgById.get(String(variantId)) ?? 0, total_org_qty: totalOrgQty }]];
    }

    // Location qty only (avg_cost no longer read from ims_stock directly)
    if (s.startsWith('select qty_on_hand from ims_stock where variant_id = ? and location_id = ?')) {
      const [variantId, locationId] = params;
      const key = `${variantId}|${locationId}`;
      const row = state.stockByVariant.get(key);
      return [[row ? { qty_on_hand: row.qty_on_hand } : undefined]];
    }

    if (s.startsWith('insert into ims_stock (variant_id, location_id, business_id, qty_on_hand)')) {
      const [variantId, locationId, businessId, qtyDelta] = params;
      const key = `${variantId}|${locationId}`;
      const current = state.stockByVariant.get(key);
      if (current) {
        current.business_id = businessId;
        current.qty_on_hand = Number(current.qty_on_hand) + Number(qtyDelta);
      } else {
        state.stockByVariant.set(key, {
          variant_id: variantId,
          location_id: locationId,
          business_id: businessId,
          qty_on_hand: Number(qtyDelta),
          qty_incoming: 0,
          avg_cost: 0,
        });
      }
      return [{ affectedRows: 1 }];
    }

    if (s.startsWith('update ims_stock set qty_incoming = greatest(0, qty_incoming - ?) where variant_id = ? and location_id = ?')) {
      const [qty, variantId, locationId] = params;
      const key = `${variantId}|${locationId}`;
      const row = state.stockByVariant.get(key);
      if (row) row.qty_incoming = Math.max(0, Number(row.qty_incoming || 0) - Number(qty));
      return [{ affectedRows: row ? 1 : 0 }];
    }

    // Org-wide avg mirror: update ALL stock rows for this variant
    if (s.startsWith('update ims_stock set avg_cost = ? where variant_id = ?')) {
      const [avgCost, variantId] = params;
      for (const row of state.stockByVariant.values()) {
        if (row.variant_id === variantId) row.avg_cost = Number(avgCost);
      }
      return [{ affectedRows: 1 }];
    }

    if (s.startsWith('update ims_product_variants set avg_cost = ? where variant_id = ?')) {
      const [avgCost, variantId] = params;
      state.variantAvgById.set(String(variantId), Number(avgCost));
      return [{ affectedRows: 1 }];
    }

    if (s.startsWith('insert into ims_stock_movements')) {
      state.movements.push({
        business_id: params[0],
        variant_id: params[1],
        location_id: params[2],
        reference_id: params[3],
        qty_change: Number(params[4]),
        qty_after_soh: Number(params[5]),
        unit_cost: Number(params[6]),
      });
      return [{ affectedRows: 1 }];
    }

    if (s.includes('select id, variant_id, qty_ordered, qty_received from ims_purchase_order_items where po_id = ?')) {
      const [poId] = params;
      return [state.items.filter((i) => i.po_id === poId).map((i) => ({
        id: i.id,
        variant_id: i.variant_id,
        qty_ordered: i.qty_ordered,
        qty_received: i.qty_received,
      }))];
    }

    if (s.startsWith('select id from ims_purchase_orders where po_number = ?')) return [[]];

    if (s.startsWith('select * from ims_purchase_order_items where po_id = ?')) {
      return [state.items.map((item) => ({ ...item, discount_pct: item.discount_pct ?? 0 }))];
    }

    if (s.startsWith('insert into ims_purchase_orders')) return [{ insertId: 91 }];
    if (s.startsWith('insert into ims_purchase_order_items')) return [{ insertId: 301 }];
    if (s.startsWith('insert into ims_po_backorder_lines')) return [{ affectedRows: 1 }];
    if (s.startsWith('update ims_purchase_order_items set qty_ordered = ?, line_total = ? where id = ?')) {
      const [qtyOrdered, lineTotal, itemId] = params;
      const row = state.items.find((item) => item.id === itemId);
      if (row) { row.qty_ordered = qtyOrdered; row.line_total = lineTotal; }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (s.startsWith('delete from ims_purchase_order_items where id = ?')) return [{ affectedRows: 1 }];
    if (s.startsWith('update ims_purchase_orders set subtotal = ?, tax_amount = ?, total_amount = ?')) return [{ affectedRows: 1 }];

    if (s.startsWith("update ims_purchase_orders set status = 'complete', received_date = curdate() where id = ?")) {
      state.po.status = 'complete';
      return [{ affectedRows: 1 }];
    }

    if (s.startsWith("update ims_purchase_orders set status = 'partially_received' where id = ?")) {
      state.po.status = 'partially_received';
      return [{ affectedRows: 1 }];
    }

    if (s.startsWith('insert into ims_stock (business_id, variant_id, location_id)')) {
      return [{ affectedRows: 1 }];
    }

    if (s.startsWith('update ims_product_variants set barcode = ? where variant_id = ?')) {
      return [{ affectedRows: 1 }];
    }

    throw new Error(`Unhandled SQL in test double: ${sql}`);
  });

  return { beginTransaction, commit, rollback, release, execute };
}

describe('POST /api/ims/receive/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'biz-1' });
    mockTriggerPOXeroSync.mockResolvedValue(undefined);
    mockRefreshVariantCache.mockResolvedValue(undefined);
  });

  it('recalculates avg cost with tax-exclusive FX AUD cost, applies over-receive clamp, and completes PO', async () => {
    const state = {
      po: {
        id: 11,
        status: 'confirmed',
        is_historical: 0,
        exchange_rate: 1.5,
        tax_treatment: 'inc_tax',
        freight: 10,
      },
      settings: [
        { key: 'freight_treatment', value: 'capitalise' },
        { key: 'landed_cost_treatment', value: 'capitalise' },
      ],
      items: [
        {
          id: 101,
          po_id: 11,
          variant_id: 'v-1',
          qty_ordered: 10,
          qty_received: 8,
          unit_cost: 11,
          tax_rate: 0.1,
        },
      ],
      stockByVariant: new Map<string, Row>([
        ['v-1|4', { variant_id: 'v-1', location_id: 4, business_id: 'biz-1', qty_on_hand: 10, qty_incoming: 5, avg_cost: 8 }],
      ]),
      landedRows: [{ amount: 20 }],
      paymentAgg: { tot_foreign: 100, tot_local: 150 },
      movements: [] as Row[],
      variantAvgById: new Map<string, number>([['v-1', 8]]),
    };

    mockGetConnection.mockResolvedValue(buildFakeConnection(state));

    const res = await POST(makeRequest({
      po_id: 11,
      location_id: 4,
      received_items: [{ variant_id: 'v-1', qty_received: 5 }],
      mark_po_received: false,
    }));

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.newStatus).toBe('complete');

    // Requested 5 but only 2 outstanding (10 ordered, 8 already received).
    const stock = state.stockByVariant.get('v-1|4')!;
    expect(stock.qty_on_hand).toBe(12);
    expect(stock.qty_incoming).toBe(3);

    // true cost = (11 inc tax -> 10 ex tax) * 1.5 + landed/freight allocation 3 = 18
    // new avg = (10*8 + 2*18) / 12 = 9.666666...
    expect(stock.avg_cost).toBeCloseTo((10 * 8 + 2 * 18) / 12, 8);

    expect(state.movements).toHaveLength(1);
    expect(state.movements[0].business_id).toBe('biz-1');
    expect(state.movements[0].qty_change).toBe(2);
    expect(state.movements[0].unit_cost).toBeCloseTo(18, 8);

    expect(mockTriggerPOXeroSync).toHaveBeenCalledWith('biz-1', 11, 'complete');
  });

  it('replays a completed receive operation without applying stock twice', async () => {
    const state = {
      po: { id: 12, status: 'confirmed', is_historical: 0, exchange_rate: 1, tax_treatment: 'ex_tax', freight: 0 },
      settings: [],
      items: [{ id: 102, po_id: 12, variant_id: 'v-2', qty_ordered: 2, qty_received: 0, unit_cost: 5, tax_rate: 0.1 }],
      stockByVariant: new Map<string, Row>([['v-2|4', { variant_id: 'v-2', location_id: 4, business_id: 'biz-1', qty_on_hand: 0, qty_incoming: 2, avg_cost: 0 }]]),
      landedRows: [],
      paymentAgg: { tot_foreign: 0, tot_local: 0 },
      movements: [] as Row[],
      variantAvgById: new Map<string, number>([['v-2', 0]]),
    };
    const connection = buildFakeConnection(state);
    mockGetConnection.mockResolvedValue(connection);
    const payload = {
      po_id: 12,
      location_id: 4,
      received_items: [{ variant_id: 'v-2', qty_received: 2 }],
      mark_po_received: true,
      operation_key: 'receive-12-revision-1',
    };

    const first = await POST(makeRequest(payload));
    mockTriggerPOXeroSync.mockRejectedValueOnce(new Error('Xero unavailable'));
    const second = await POST(makeRequest(payload));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ success: true, replayed: true, newStatus: 'complete' });
    expect(state.stockByVariant.get('v-2|4')?.qty_on_hand).toBe(2);
    expect(state.movements).toHaveLength(1);
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      operation: 'receive_xero_approval',
      context: { replayed: true },
      reference: { type: 'purchase_order', id: 12 },
    }));
  });

  it('keeps PO partially_received and excludes landed/freight when settings are expense', async () => {
    const state = {
      po: {
        id: 22,
        status: 'confirmed',
        is_historical: 0,
        exchange_rate: 1.5,
        tax_treatment: 'inc_tax',
        freight: 10,
      },
      settings: [
        { key: 'freight_treatment', value: 'expense' },
        { key: 'landed_cost_treatment', value: 'expense' },
      ],
      items: [
        {
          id: 202,
          po_id: 22,
          variant_id: 'v-2',
          qty_ordered: 10,
          qty_received: 2,
          unit_cost: 11,
          tax_rate: 0.1,
        },
      ],
      stockByVariant: new Map<string, Row>([
        ['v-2|4', { variant_id: 'v-2', location_id: 4, business_id: 'biz-1', qty_on_hand: 0, qty_incoming: 10, avg_cost: 0 }],
      ]),
      landedRows: [{ amount: 999 }],
      paymentAgg: { tot_foreign: 100, tot_local: 150 },
      movements: [] as Row[],
      variantAvgById: new Map<string, number>([['v-2', 0]]),
    };

    mockGetConnection.mockResolvedValue(buildFakeConnection(state));

    const res = await POST(makeRequest({
      po_id: 22,
      location_id: 4,
      received_items: [{ variant_id: 'v-2', qty_received: 3 }],
      mark_po_received: false,
    }));

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.newStatus).toBe('partially_received');

    const stock = state.stockByVariant.get('v-2|4')!;
    expect(stock.qty_on_hand).toBe(3);
    expect(stock.qty_incoming).toBe(7);

    // Settings exclude landed+freight, so receipt unit cost is ex-tax FX only:
    // 11 inc tax -> 10 ex tax; 10 * 1.5 = 15.
    expect(stock.avg_cost).toBeCloseTo(15, 8);
    expect(state.movements[0].unit_cost).toBeCloseTo(15, 8);

    expect(mockTriggerPOXeroSync).not.toHaveBeenCalled();
  });

  it('moves supplier shortfalls to a held PO and resizes the original to actual receipts', async () => {
    const state = {
      po: {
        id: 33,
        business_id: 'biz-1',
        po_number: 'PO-2026-0033',
        supplier_id: 8,
        location_id: 4,
        status: 'confirmed',
        is_historical: 0,
        exchange_rate: 1,
        tax_treatment: 'inc_tax',
        freight: 0,
        discount: 0,
        xero_bill_id: null,
      },
      settings: [],
      items: [{
        id: 303,
        po_id: 33,
        variant_id: 'v-3',
        qty_ordered: 10,
        qty_received: 0,
        unit_cost: 11,
        discount_pct: 0,
        tax_rate: 0.1,
        line_total: 110,
      }],
      stockByVariant: new Map<string, Row>([
        ['v-3|4', { variant_id: 'v-3', location_id: 4, business_id: 'biz-1', qty_on_hand: 0, qty_incoming: 10, avg_cost: 0 }],
      ]),
      landedRows: [],
      paymentAgg: { tot_foreign: 0, tot_local: 0 },
      movements: [] as Row[],
      variantAvgById: new Map<string, number>([['v-3', 0]]),
    };
    const connection = buildFakeConnection(state);
    mockGetConnection.mockResolvedValue(connection);

    const res = await POST(makeRequest({
      po_id: 33,
      location_id: 4,
      received_items: [{ variant_id: 'v-3', qty_received: 3 }],
      mark_po_received: true,
      create_backorder_po: true,
    }));

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.backorderPoId).toBe(91);
    expect(json.backorderPoNumber).toBe('PO-2026-0033-B');
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("'backordered'"),
      expect.arrayContaining(['biz-1', 'PO-2026-0033-B']),
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_po_backorder_lines'),
      expect.arrayContaining(['biz-1', 33, 303, 91, 301, 7]),
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('SET qty_ordered = ?, line_total = ?'),
      [3, 33, 303],
    );
    expect(state.stockByVariant.get('v-3|4')?.qty_incoming).toBe(7);
    expect(mockTriggerPOXeroSync).toHaveBeenCalledWith('biz-1', 33, 'complete');
  });
});
