import { beforeEach, describe, expect, it, vi } from 'vitest';

const { connection, getIMSPool } = vi.hoisted(() => {
  const connection = { beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
  return { connection, getIMSPool: vi.fn(() => ({ getConnection: async () => connection })) };
});
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool, imsQuery: vi.fn() }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: async () => 'Australia/Sydney' }));
vi.mock('@/lib/ims/costing/fifoCostingService', () => ({ lockInventoryCostState: vi.fn().mockResolvedValue({ method: 'average' }) }));
import { LaybyRepository } from '../laybyRepository';

const actor = { businessId: 'business-1', locationId: 1, registerId: 2, registerSessionId: 3, cashierId: 4 };
const sale = { id: 10, business_id: 'business-1', location_id: 1, status: 'layby_active', total: 129.95, tax_total: 11.81 };

describe('transactional layby lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connection.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM pos_sales')) return [[sale]];
      if (sql.includes('SELECT id FROM pos_layby_events')) return [[]];
      if (sql.includes('SELECT id FROM pos_register_sessions')) return [[{ id: 3 }]];
      if (sql.includes('SELECT * FROM pos_sale_items')) return [[{ variant_id: 'sku', qty: 1 }]];
      if (sql.includes('SELECT * FROM pos_laybys')) return [[{ state: 'active', paid_total: 26, fee_percent: 0, gst_recognized: 0 }]];
      if (sql.includes('SELECT * FROM pos_layby_reservations')) return [[{ variant_id: 'sku', quantity: 1 }]];
      if (sql.includes('SELECT qty_on_hand, qty_committed')) return [[{ qty_on_hand: 2, qty_committed: 1 }]];
      return [{ insertId: 20, affectedRows: 1 }];
    });
  });
  it('uses the current branch as a hard sale lookup boundary', async () => {
    connection.execute.mockResolvedValueOnce([[]]);
    await expect(LaybyRepository.act({ actor, saleId: 10, operationKey: 'operation-1', action: 'collect', collectStock: vi.fn() })).rejects.toThrow('current branch');
    expect(connection.execute.mock.calls[0][1]).toEqual([10, 'business-1', 1]);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
  it('does not insert another payment for a repeated operation', async () => {
    connection.execute.mockResolvedValueOnce([[sale]]).mockResolvedValueOnce([[{ id: 1 }]]);
    const result = await LaybyRepository.act({ actor, saleId: 10, operationKey: 'operation-1', action: 'payment', payments: [{ payment_method: 'Card', amount: 30 }], collectStock: vi.fn() });
    expect(result.duplicate).toBe(true);
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
  });
  it('rolls back final payment if collection stock fails', async () => {
    const collectStock = vi.fn().mockRejectedValue(new Error('FIFO cost conflict'));
    await expect(LaybyRepository.act({ actor, saleId: 10, operationKey: 'operation-1', action: 'payment', payments: [{ payment_method: 'Card', amount: 103.95 }], collect: true, collectStock })).rejects.toThrow('FIFO');
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
  it('records a partial instalment without touching stock', async () => {
    const collectStock = vi.fn();
    await LaybyRepository.act({ actor, saleId: 10, operationKey: 'operation-1', action: 'payment', payments: [{ payment_method: 'Card', amount: 30 }], collectStock });
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(collectStock).not.toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('qty_committed = qty_committed -'))).toBe(false);
  });
  it('collects once with the final instalment, recording GST and exclusive revenue', async () => {
    const collectStock = vi.fn();
    await LaybyRepository.act({ actor, saleId: 10, operationKey: 'operation-1', action: 'payment', payments: [{ payment_method: 'Card', amount: 103.95 }], collect: true, collectStock });
    expect(collectStock).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    const events = connection.execute.mock.calls.filter(([sql]) => sql.includes('INSERT INTO pos_layby_events')).map(([, values]) => values);
    expect(events.map(values => [values[3], values[4]])).toEqual([['receipt', 103.95], ['gst', 129.95], ['collection', 118.14]]);
  });
  it('keeps stock reserved when final payment is marked collect later', async () => {
    const collectStock = vi.fn();
    await LaybyRepository.act({ actor, saleId: 10, operationKey: 'operation-1', action: 'payment', payments: [{ payment_method: 'Card', amount: 103.95 }], collect: false, collectStock });
    expect(collectStock).not.toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('qty_committed = qty_committed -'))).toBe(false);
    expect(connection.execute.mock.calls.find(([sql]) => sql.includes('UPDATE pos_laybys SET paid_total'))?.[1]).toEqual([129.95, 'paid', 11.81, 10, 'business-1']);
  });
  it('cancels with the exact refund and releases the reservation without selling stock', async () => {
    const collectStock = vi.fn();
    await LaybyRepository.act({ actor, saleId: 10, operationKey: 'operation-1', action: 'cancel', payments: [{ payment_method: 'Card', amount: -26 }], collectStock });
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(collectStock).not.toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => sql.includes('qty_committed = qty_committed -'))).toBe(true);
  });
});