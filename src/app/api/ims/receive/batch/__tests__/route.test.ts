import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const {
  mockGetImsSession,
  mockTriggerPOXeroSync,
  mockRefreshVariantCache,
  mockGetConnection,
} = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockTriggerPOXeroSync: vi.fn(),
  mockRefreshVariantCache: vi.fn(),
  mockGetConnection: vi.fn(),
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

  const execute = vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (s.includes('from ims_purchase_orders where id = ? for update')) {
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

    if (s.startsWith('select qty_on_hand, avg_cost from ims_stock where variant_id = ? and location_id = ?')) {
      const [variantId, locationId] = params;
      const key = `${variantId}|${locationId}`;
      const row = state.stockByVariant.get(key);
      return [[row ? { qty_on_hand: row.qty_on_hand, avg_cost: row.avg_cost } : undefined]];
    }

    if (s.startsWith('insert into ims_stock (variant_id, location_id, business_id, qty_on_hand)')) {
      const [variantId, locationId, businessId, qtyDelta, avgCost] = params;
      const key = `${variantId}|${locationId}`;
      const current = state.stockByVariant.get(key);
      if (current) {
        current.business_id = businessId;
        current.qty_on_hand = Number(current.qty_on_hand) + Number(qtyDelta);
        current.avg_cost = Number(avgCost);
      } else {
        state.stockByVariant.set(key, {
          variant_id: variantId,
          location_id: locationId,
          business_id: businessId,
          qty_on_hand: Number(qtyDelta),
          qty_incoming: 0,
          avg_cost: Number(avgCost),
        });
      }
      return [{ affectedRows: 1 }];
    }

    if (s.startsWith('update ims_stock set avg_cost = ? where variant_id = ? and location_id = ?')) {
      const [avgCost, variantId, locationId] = params;
      const key = `${variantId}|${locationId}`;
      const row = state.stockByVariant.get(key);
      if (row) row.avg_cost = Number(avgCost);
      return [{ affectedRows: row ? 1 : 0 }];
    }

    if (s.startsWith('update ims_stock set qty_incoming = greatest(0, qty_incoming - ?) where variant_id = ? and location_id = ?')) {
      const [qty, variantId, locationId] = params;
      const key = `${variantId}|${locationId}`;
      const row = state.stockByVariant.get(key);
      if (row) row.qty_incoming = Math.max(0, Number(row.qty_incoming || 0) - Number(qty));
      return [{ affectedRows: row ? 1 : 0 }];
    }

    if (s.includes('select sum(qty_on_hand * avg_cost) as total_value, sum(qty_on_hand) as total_qty from ims_stock')) {
      const [variantId] = params;
      let totalValue = 0;
      let totalQty = 0;
      for (const row of state.stockByVariant.values()) {
        if (row.variant_id === variantId && Number(row.qty_on_hand) > 0) {
          totalValue += Number(row.qty_on_hand) * Number(row.avg_cost || 0);
          totalQty += Number(row.qty_on_hand);
        }
      }
      return [[{ total_value: totalValue, total_qty: totalQty }]];
    }

    if (s.startsWith('update ims_product_variants set avg_cost = ? where variant_id = ?')) {
      const [avgCost, variantId] = params;
      state.variantAvgById.set(String(variantId), Number(avgCost));
      return [{ affectedRows: 1 }];
    }

    if (s.startsWith('insert into ims_stock_movements')) {
      state.movements.push({
        variant_id: params[0],
        location_id: params[1],
        reference_id: params[2],
        qty_change: Number(params[3]),
        qty_after_soh: Number(params[4]),
        unit_cost: Number(params[5]),
      });
      return [{ affectedRows: 1 }];
    }

    if (s.includes('select variant_id, qty_ordered, qty_received from ims_purchase_order_items where po_id = ?')) {
      const [poId] = params;
      return [state.items.filter((i) => i.po_id === poId).map((i) => ({
        variant_id: i.variant_id,
        qty_ordered: i.qty_ordered,
        qty_received: i.qty_received,
      }))];
    }

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
      variantAvgById: new Map<string, number>(),
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
    expect(state.movements[0].qty_change).toBe(2);
    expect(state.movements[0].unit_cost).toBeCloseTo(18, 8);

    expect(mockTriggerPOXeroSync).toHaveBeenCalledWith('biz-1', 11, 'complete');
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
      variantAvgById: new Map<string, number>(),
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
});
