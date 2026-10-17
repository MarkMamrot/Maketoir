import type { PoolConnection } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const outside = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), pool: vi.fn(), report: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: outside.query, imsExecute: outside.execute, getIMSPool: outside.pool,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: outside.report }));

import { cancelShopifyOrderInTransaction, importShopifyOrderInTransaction } from '../shopifyOrderImport';
import { updateShopifyOrderInTransaction } from '../shopifyOrderUpdate';
import { applyShopifyOrderRefundInTransaction } from '../shopifyOrderRefund';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { assertShopifyOrderLineMappings } from '../shopifyOrderLineMapping';

const input = {
  businessId: 'business-1', channelInstanceId: 'channel-1',
  locationId: 7, topic: 'orders/paid' as const,
  order: {
    id: 1001, name: '#1001', financial_status: 'paid', total_price: '22', total_tax: '2',
    subtotal_price: '20', created_at: '2026-10-17T00:00:00Z',
    customer: { id: 7001 },
    line_items: [{ id: 9001, variant_id: 8001, quantity: 2, price: '10', variant_inventory_management: 'shopify' }],
  },
};

function fixture(options: {
  status?: string | null; credits?: boolean; costEvidence?: boolean; allocations?: boolean;
  mappings?: Array<{ external_variant_id: string; variant_id: string }>; fail?: string;
  fulfilled?: number; configuredCustomer?: boolean; buildLines?: boolean;
  additionalLine?: boolean;
  refundLifecycle?: boolean;
} = {}) {
  let status = options.status === undefined ? 'confirmed' : options.status;
  let completedCredit: { id: number; total_amount: number; tax_amount: number } | null = null;
  let stockOnHand = 4;
  const sourceItems = [{
    id: 101, so_id: 44, business_id: input.businessId, external_order_item_id: '9001',
    shopify_line_item_id: '9001', variant_id: 'variant-1', qty_ordered: 2,
    qty_fulfilled: options.fulfilled ?? 0, unit_price: 10, discount_pct: 0, tax_rate: 0.1, unit_cost: 3, sku: 'BLUE',
  }];
  if (options.refundLifecycle && status === null) sourceItems.length = 0;
  if (options.additionalLine) sourceItems.push({
    ...sourceItems[0], id: 102, external_order_item_id: '9002', shopify_line_item_id: '9002', qty_ordered: 3,
  });
  const header = () => ({
    id: 44, business_id: input.businessId, location_id: 7, status, so_type: 'online',
    tax_treatment: 'inc_tax', freight: 0, discount: 0, so_number: 'SO-44', customer_id: 9,
    sales_channel: 'shopify', channel_instance_id: input.channelInstanceId, payment_gateway: 'shopify_payments',
  });
  const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (options.fail && sql.includes(options.fail)) throw new Error('Injected local failure');
    if (sql.includes('SELECT active_method')) return [[{ active_method: 'average_cost', revision: 1 }], []];
    if (sql.includes('SELECT id, status FROM ims_sales_orders')) return [status ? [header()] : [], []];
    if (sql.includes('SELECT id, payment_gateway FROM ims_sales_orders')
      || sql.includes('SELECT id, location_id, so_type, so_number')) return [[header()], []];
    if (sql.includes('FROM ims_sales_channel_product_mappings')) {
      return [options.mappings ?? [{ external_variant_id: '8001', variant_id: 'variant-1' }], []];
    }
    if (sql.includes('FROM ims_contact_channel_mappings')) return [[{
      id: 1, business_id: input.businessId, channel_instance_id: input.channelInstanceId,
      external_customer_id: '7001', contact_id: 9, mapping_status: 'linked',
    }], []];
    if (sql.includes('JOIN ims_contacts c ON c.id = CAST')) return [options.configuredCustomer === false ? [] : [{ id: 5 }], []];
    if (sql.includes('SELECT * FROM ims_sales_orders') || sql.includes('SELECT status, location_id, business_id')) return [[header()], []];
    if (sql.includes('JOIN ims_product_build_recipes')) return [options.buildLines
      ? [{ id: 101, variant_id: 'variant-1', qty_ordered: 2, qty_fulfilled: 0, revision: 1 }] : [], []];
    if (sql.includes('FROM ims_sales_order_items')) return [sourceItems, []];
    if (sql.includes('FROM ims_credit_notes')) return [completedCredit ? [completedCredit] : options.credits ? [{ id: 8 }] : [], []];
    if (sql.includes('FROM ims_stock_movements movement')) return [options.costEvidence ? [{ id: 9 }] : [], []];
    if (sql.includes('FROM ims_stock_allocations')) return [options.allocations ? [{ id: 10 }] : [], []];
    if (sql.includes('COALESCE(p.is_stock_item')) return [[{ variant_id: 'variant-1', is_stock_item: 1 }], []];
    if (sql.includes('SELECT freight, discount, tax_treatment')) return [[header()], []];
    if (sql.includes('SELECT id, location_id, status, sales_channel')) return [[header()], []];
    if (sql.includes('SELECT qty_on_hand')) return [[{ qty_on_hand: stockOnHand, qty_committed: 2 }], []];
    if (sql.startsWith('SELECT')) return [[], []];
    if (options.refundLifecycle && sql.includes('INSERT INTO ims_sales_order_items')) {
      sourceItems.push({
        id: 101, so_id: 44, business_id: input.businessId,
        shopify_line_item_id: String(params[2]), external_order_item_id: String(params[3]),
        variant_id: String(params[4]), qty_ordered: Number(params[5]), qty_fulfilled: 0,
        unit_price: Number(params[6]), discount_pct: 0, tax_rate: 0.1, unit_cost: 0, sku: 'BLUE',
      });
    }
    if (options.refundLifecycle && sql.includes('UPDATE ims_sales_order_items')) {
      const item = sourceItems.find(row => row.id === Number(params[params.length - 2]));
      if (!item) throw new Error('Source line identity changed unexpectedly');
      item.external_order_item_id = String(params[2]);
      item.variant_id = String(params[3]);
      item.qty_ordered = Number(params[4]);
    }
    if (sql.includes('INSERT IGNORE INTO ims_credit_notes')) {
      completedCredit = { id: 81, total_amount: Number(params[13]), tax_amount: Number(params[12]) };
      return [{ insertId: 81, affectedRows: 1 }, []];
    }
    if (sql.includes('UPDATE ims_stock SET qty_on_hand = qty_on_hand + ?')) stockOnHand += Number(params[0]);
    if (sql.includes('INSERT INTO ims_sales_orders')) status = 'draft';
    if (sql.includes('UPDATE ims_sales_orders SET status = ?')) status = String(params[0]);
    return [{ insertId: sql.includes('INSERT INTO ims_sales_orders') ? 44 : 5, affectedRows: 1 }, []];
  });
  const connection = {
    execute, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  };
  return {
    connection: connection as unknown as PoolConnection, execute, lifecycle: connection, sourceItems,
    stockOnHand: () => stockOnHand,
  };
}

function assertCallerOwnership(context: ReturnType<typeof fixture>) {
  expect(outside.pool).not.toHaveBeenCalled();
  expect(outside.query).not.toHaveBeenCalled();
  expect(outside.execute).not.toHaveBeenCalled();
  expect(outside.report).not.toHaveBeenCalled();
  for (const method of ['beginTransaction', 'commit', 'rollback', 'release'] as const) {
    expect(context.lifecycle[method]).not.toHaveBeenCalled();
  }
  expect(context.execute.mock.calls.some(([sql]) => /\b(ALTER|CREATE|SHOW)\b/.test(sql))).toBe(false);
  const sql = context.execute.mock.calls.map(([statement]) => statement);
  expect(sql.findIndex(statement => statement.includes('SELECT active_method')))
    .toBeLessThan(sql.findIndex(statement => statement.includes('FROM ims_sales_orders')));
}

describe('Shopify caller-owned local transactions with real repository and helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const method of [outside.query, outside.execute, outside.pool]) {
      method.mockImplementation(() => { throw new Error('Outside caller connection'); });
    }
  });

  it('imports, confirms commitments and refreshes builds entirely before caller commit', async () => {
    const context = fixture({ status: null });
    await expect(importShopifyOrderInTransaction(context.connection, input))
      .resolves.toEqual({ outcome: 'imported', salesOrderId: 44 });
    expect(context.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ims_stock '),
      ['variant-1', 7, 'business-1', 2]);
    expect(context.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE ims_product_build_requirements'),
      ['business-1', 44]);
    expect(context.execute).toHaveBeenCalledWith(expect.stringContaining('FROM ims_contact_channel_mappings'),
      ['business-1', 'channel-1', '7001']);
    assertCallerOwnership(context);
  });

  it('creates custom non-stock fallback, fallback customer and settings on the same connection', async () => {
    const context = fixture({ status: null, configuredCustomer: false, mappings: [] });
    await importShopifyOrderInTransaction(context.connection, {
      ...input, order: { ...input.order, customer: undefined,
        line_items: [{ id: 9001, variant_id: null, quantity: 2, price: '10' }] },
    });
    expect(context.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ims_products'),
      expect.arrayContaining(['business-1', 'SHOPIFY-MISC']));
    expect(context.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ims_contacts'), ['business-1']);
    expect(context.execute.mock.calls.some(([sql]) => sql.includes('GET_LOCK'))).toBe(false);
    assertCallerOwnership(context);
  });

  it.each([{ reason: 'missing_variant_mapping', mappings: [] }, { reason: 'ambiguous_variant_mapping', mappings: [
    { external_variant_id: '8001', variant_id: 'variant-1' },
    { external_variant_id: '8001', variant_id: 'variant-2' },
  ] }])('rejects missing or ambiguous stock mappings before inserting an order', async ({ mappings, reason }) => {
    const context = fixture({ status: null, mappings });
    await expect(importShopifyOrderInTransaction(context.connection, input)).rejects.toMatchObject({
      name: 'ShopifyOrderReviewRequiredError', code: 'SHOPIFY_ORDER_REVIEW_REQUIRED', reason,
    });
    expect(context.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO ims_sales_orders'))).toBe(false);
    assertCallerOwnership(context);
  });

  it('replays an exact import without replacing source lines', async () => {
    const context = fixture();
    await expect(importShopifyOrderInTransaction(context.connection, input))
      .resolves.toEqual({ outcome: 'updated', salesOrderId: 44 });
    expect(context.execute.mock.calls.some(([sql]) => /(?:INSERT INTO|UPDATE) ims_sales_order_items/.test(sql))).toBe(false);
    assertCallerOwnership(context);
  });

  it('updates existing lines by their external identity, not just their variant', async () => {
    const context = fixture();
    await updateShopifyOrderInTransaction(context.connection, input);
    expect(context.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE ims_sales_order_items'),
      expect.arrayContaining([101, 44, '9001', 'variant-1']));
    expect(context.execute).toHaveBeenCalledWith(expect.stringContaining('SET subtotal = ?'),
      expect.arrayContaining([20, 2, 22, 9]));
    assertCallerOwnership(context);
  });

  it('retains exact source IDs when same-variant provider lines are reordered', async () => {
    const context = fixture({ additionalLine: true });
    await updateShopifyOrderInTransaction(context.connection, {
      ...input, order: { ...input.order, line_items: [
        { ...input.order.line_items[0], id: 9002, quantity: 3 },
        input.order.line_items[0],
      ] },
    });
    const updates = context.execute.mock.calls.filter(([sql]) => sql.includes('UPDATE ims_sales_order_items'));
    expect(updates.map(([, params = []]) => [params[2], params[params.length - 2]])).toEqual([
      ['9002', 102], ['9001', 101],
    ]);
    assertCallerOwnership(context);
  });

  it('retains original refunded quantity and IDs after a completed CN', async () => {
    const context = fixture({ credits: true });
    await updateShopifyOrderInTransaction(context.connection, {
      ...input, order: { ...input.order,
        refunds: [{ refund_line_items: [{ line_item_id: 9001, quantity: 1 }] }],
        line_items: [{ ...input.order.line_items[0], current_quantity: 0 }],
      },
    });
    expect(context.execute.mock.calls.some(([sql]) => /(?:DELETE FROM|UPDATE|INSERT INTO) ims_sales_order_items/.test(sql))).toBe(false);
    assertCallerOwnership(context);
  });

  it.each([
    { currentQuantity: 1, refundedQuantity: 1, useNestedIdentity: false },
    { currentQuantity: 0, refundedQuantity: 2, useNestedIdentity: true },
  ])('preserves missing-order source quantities through import, update and the real CN owner: %j', async ({
    currentQuantity, refundedQuantity, useNestedIdentity,
  }) => {
    const context = fixture({ status: null, refundLifecycle: true });
    const refund = {
      id: 7001, order_id: 1001,
      transactions: [{ kind: 'refund', status: 'success', amount: String(refundedQuantity * 11), gateway: 'shopify_payments' }],
      refund_line_items: [{
        ...(useNestedIdentity ? {} : { line_item_id: 9001 }),
        quantity: refundedQuantity, subtotal: String(refundedQuantity * 11), total_tax: String(refundedQuantity),
        restock_type: 'return', line_item: { id: 9001, variant_id: 8001, title: 'Original source' },
      }],
    };
    const snapshot = {
      ...input, order: { ...input.order, refunds: [refund],
        line_items: [{ ...input.order.line_items[0], price: '11', current_quantity: currentQuantity }],
      },
    };

    await importShopifyOrderInTransaction(context.connection, snapshot);
    await updateShopifyOrderInTransaction(context.connection, snapshot);
    expect(context.sourceItems).toEqual([expect.objectContaining({
      id: 101, external_order_item_id: '9001', qty_ordered: 2, qty_fulfilled: 0, unit_price: 11,
    })]);
    expect(context.stockOnHand()).toBe(4);
    expect(context.execute.mock.calls.some(([sql]) => sql.includes('qty_on_hand = qty_on_hand + ?'))).toBe(false);

    const refundInput = { businessId: input.businessId, channelInstanceId: input.channelInstanceId, refund };
    await expect(applyShopifyOrderRefundInTransaction(context.connection, refundInput))
      .resolves.toEqual({ outcome: 'refunded', salesOrderId: 44, creditNoteId: 81 });
    expect(context.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ims_credit_note_items'), [
      81, 'variant-1', 'BLUE', 'Original source', refundedQuantity, 10, 1, 0.1, refundedQuantity * 10, 101,
    ]);
    expect(context.stockOnHand()).toBe(4 + refundedQuantity);
    expect(context.sourceItems[0]).toMatchObject({ id: 101, qty_ordered: 2, qty_fulfilled: 0 });

    await updateShopifyOrderInTransaction(context.connection, snapshot);
    await expect(applyShopifyOrderRefundInTransaction(context.connection, refundInput))
      .resolves.toEqual({ outcome: 'duplicate', salesOrderId: 44, creditNoteId: 81 });
    expect(context.sourceItems[0]).toMatchObject({ id: 101, qty_ordered: 2, qty_fulfilled: 0 });
    expect(context.execute.mock.calls.filter(([sql]) => sql.includes('qty_on_hand = qty_on_hand + ?'))).toHaveLength(1);
    expect(context.execute.mock.calls.filter(([sql]) => sql.includes("'cn_returned'"))).toHaveLength(1);
    assertCallerOwnership(context);
  });

  it('keeps partial fulfilment cost/source quantities intact while the CN owns a subsequent refund', async () => {
    const context = fixture({ status: 'partially_fulfilled', fulfilled: 1, refundLifecycle: true });
    const refund = {
      id: 7001, order_id: 1001,
      transactions: [{ kind: 'refund', status: 'success', amount: '11', gateway: 'shopify_payments' }],
      refund_line_items: [{
        line_item_id: 9001, quantity: 1, subtotal: '11', total_tax: '1', restock_type: 'return',
        line_item: { id: 9001, variant_id: 8001, title: 'Original source' },
      }],
    };
    const snapshot = {
      ...input, order: { ...input.order, refunds: [refund],
        line_items: [{ ...input.order.line_items[0], current_quantity: 0 }],
      },
    };
    await updateShopifyOrderInTransaction(context.connection, snapshot);
    expect(context.execute.mock.calls.some(([sql]) => sql.includes('UPDATE ims_sales_order_items'))).toBe(false);
    expect(context.stockOnHand()).toBe(4);
    await applyShopifyOrderRefundInTransaction(context.connection, {
      businessId: input.businessId, channelInstanceId: input.channelInstanceId, refund,
    });
    expect(context.sourceItems[0]).toMatchObject({ id: 101, qty_ordered: 2, qty_fulfilled: 1, unit_cost: 3 });
    expect(context.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ims_credit_note_items'),
      expect.arrayContaining([81, 'variant-1', 101]));
    expect(context.execute).toHaveBeenCalledWith(expect.stringContaining("'cn_returned'"), [
      'business-1', 'variant-1', 7, 'online', 81, 5, 1, 5, 3, 'average_cost', null,
    ]);
    expect(context.stockOnHand()).toBe(5);
    assertCallerOwnership(context);
  });

  it.each([{ credits: true }, { costEvidence: true }, { fulfilled: 1 }])(
    'refuses quantity changes with existing refund or fulfilment provenance: %j', async evidence => {
      const context = fixture(evidence);
      await expect(updateShopifyOrderInTransaction(context.connection, {
        ...input, order: { ...input.order, line_items: [{ ...input.order.line_items[0], current_quantity: 1 }] },
      })).rejects.toMatchObject({
        code: 'SHOPIFY_ORDER_REVIEW_REQUIRED', reason: 'source_provenance_conflict',
        message: expect.stringMatching(/provenance/),
      });
      expect(context.execute.mock.calls.some(([sql]) => sql.includes('SET subtotal = ?'))).toBe(false);
      assertCallerOwnership(context);
    },
  );

  it('preserves metadata-only updates after partial fulfilment', async () => {
    const context = fixture({ status: 'partially_fulfilled', fulfilled: 1 });
    await updateShopifyOrderInTransaction(context.connection, input);
    expect(context.execute.mock.calls.some(([sql]) => sql.includes('FROM ims_sales_order_items'))).toBe(false);
    expect(context.execute).toHaveBeenCalledWith(expect.stringContaining('SET subtotal = ?'), expect.any(Array));
    assertCallerOwnership(context);
  });

  it('cancels only outstanding commitments and closes cancelled build requirements', async () => {
    const context = fixture({ status: 'partially_fulfilled', fulfilled: 1, buildLines: true });
    await expect(cancelShopifyOrderInTransaction(context.connection, input))
      .resolves.toEqual({ outcome: 'cancelled', salesOrderId: 44 });
    expect(context.execute).toHaveBeenCalledWith(expect.stringContaining('qty_committed = GREATEST(0, qty_committed - ?)'),
      [1, 'variant-1', 7]);
    expect(context.execute.mock.calls.some(([sql]) => sql.includes('qty_on_hand ='))).toBe(false);
    expect(context.execute.mock.calls.some(([sql]) => sql.includes('INSERT INTO ims_product_build_requirements'))).toBe(false);
    assertCallerOwnership(context);
  });

  it('keeps the cancellation lifecycle restriction on a fully fulfilled order', async () => {
    const context = fixture({ status: 'fulfilled', fulfilled: 2 });
    await expect(cancelShopifyOrderInTransaction(context.connection, input)).rejects.toThrow(/cannot change/);
    assertCallerOwnership(context);
  });

  it('rechecks cancelled build state on replay without repeating stock changes', async () => {
    const context = fixture({ status: 'cancelled', buildLines: true });
    await expect(cancelShopifyOrderInTransaction(context.connection, input))
      .resolves.toEqual({ outcome: 'already_cancelled', salesOrderId: 44 });
    expect(context.execute.mock.calls.some(([sql]) => sql.includes('UPDATE ims_stock '))).toBe(false);
    expect(context.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE ims_product_build_requirements'),
      ['business-1', 44]);
    assertCallerOwnership(context);
  });

  it('retains incoming-allocation protection in the canonical edit owner', async () => {
    const context = fixture({ allocations: true });
    await expect(updateShopifyOrderInTransaction(context.connection, input)).rejects.toThrow(/allocations/);
    assertCallerOwnership(context);
  });

  it.each(['INSERT INTO ims_sales_order_items', 'UPDATE ims_product_build_requirements'])(
    'propagates local failures without rolling back or swallowing: %s', async fail => {
      const context = fixture({ status: null, fail });
      await expect(importShopifyOrderInTransaction(context.connection, input)).rejects.toThrow('Injected local failure');
      assertCallerOwnership(context);
    },
  );

  it('propagates a cancelled-build refresh failure to the owner', async () => {
    const context = fixture({ fail: 'UPDATE ims_product_build_requirements' });
    await expect(cancelShopifyOrderInTransaction(context.connection, input)).rejects.toThrow('Injected local failure');
    assertCallerOwnership(context);
  });

  it.each(['UPDATE ims_sales_order_items', 'SET subtotal = ?', 'UPDATE ims_product_build_requirements'])(
    'propagates update failures without owning rollback: %s', async fail => {
      const context = fixture({ fail });
      await expect(updateShopifyOrderInTransaction(context.connection, input)).rejects.toThrow('Injected local failure');
      assertCallerOwnership(context);
    },
  );

  it('does not run lazy schema checks for direct transactional repository updates', async () => {
    const context = fixture();
    await ImsSORepo.updateInTransaction(context.connection, input.businessId, 44, { notes: 'test' });
    assertCallerOwnership(context);
  });

  it('rejects unlinked external variants even if inventory tracking was omitted', () => {
    expect(() => assertShopifyOrderLineMappings([{ variant_id: 8001, quantity: 1 }], []))
      .toThrow(/exact linked mapping/);
  });

  it('preserves the non-stock fallback for explicitly untracked Shopify extras', () => {
    expect(() => assertShopifyOrderLineMappings([{
      id: 9002, variant_id: 8002, quantity: 1, variant_inventory_management: null,
    }], [])).not.toThrow();
  });

  it('still rejects a missing mapping for an explicitly stock-tracked Shopify line', () => {
    expect(() => assertShopifyOrderLineMappings([{
      id: 9002, variant_id: 8002, quantity: 1, variant_inventory_management: 'shopify',
    }], [])).toThrow(/exact linked mapping/);
  });

  it('requires a source line identity even for explicitly untracked extras', () => {
    expect(() => assertShopifyOrderLineMappings([{
      variant_id: 8002, quantity: 1, variant_inventory_management: null,
    }], [])).toThrow(/source line identities/);
  });
});
