import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetIMSPool, mockImsExecute } = vi.hoisted(() => ({
  mockGetIMSPool: vi.fn(),
  mockImsExecute: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: mockGetIMSPool,
  imsExecute: mockImsExecute,
}));

import { reverseCustomerCreditNote, reverseSupplierCreditNote } from '../creditNotes/creditNoteCorrections';

const context = {
  operationKey: 'stable-key',
  requestHash: 'request-hash',
  expectedUpdatedAt: '2026-08-12T09:00:00.000Z',
  actorId: 7,
  actorName: 'Alex',
};

function connectionFor(kind: 'customer' | 'supplier', options: {
  source?: string;
  status?: string;
  operationState?: 'complete' | 'processing';
  contactCredit?: number;
  stockOnHand?: number;
} = {}) {
  const execute = vi.fn(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('from ims_credit_notes') && normalized.includes('for update')) {
      return [[{
        id: 12,
        business_id: 'biz-1',
        cn_number: 'CN-00012',
        status: options.status ?? 'complete',
        source: options.source ?? 'manual',
        settlement_method: 'store_credit',
        store_credit_transaction_id: 44,
        customer_id: 3,
        updated_at: '2026-08-12T09:00:00.000Z',
      }]];
    }
    if (normalized.includes('from ims_supplier_credit_notes') && normalized.includes('for update')) {
      return [[{
        id: 15,
        business_id: 'biz-1',
        scn_number: 'SCN-00015',
        status: options.status ?? 'complete',
        updated_at: '2026-08-12T09:00:00.000Z',
      }]];
    }
    if (normalized.includes('from ims_inventory_document_operations') && normalized.includes('for update')) {
      return [options.operationState ? [{
        id: 81,
        request_hash: 'request-hash',
        document_kind: kind === 'customer' ? 'customer_credit_note' : 'supplier_credit_note',
        document_id: kind === 'customer' ? 12 : 15,
        action: 'revert_mistaken_completion',
        state: options.operationState,
        response_json: JSON.stringify({
          id: kind === 'customer' ? 12 : 15,
          status: 'reversed',
          replayed: false,
          xeroCorrectionStatus: 'queued',
        }),
      }] : []];
    }
    if (normalized.startsWith('insert into ims_inventory_document_operations')) {
      return [{ insertId: 81, affectedRows: 1 }];
    }
    if (normalized.includes('from store_credit_transactions')) return [[{ id: 44, amount: 25 }]];
    if (normalized.includes('select store_credit from ims_contacts')) {
      return [[{ store_credit: options.contactCredit ?? 40 }]];
    }
    if (normalized.includes("movement_type = ?") && normalized.includes('from ims_stock_movements')) {
      return [[{
        id: 91,
        variant_id: 'v-1',
        location_id: 4,
        qty_change: kind === 'customer' ? 3 : -3,
        unit_cost: 5.5,
      }]];
    }
    if (normalized.includes('select qty_on_hand') && normalized.includes('from ims_stock')) {
      return [[{ qty_on_hand: options.stockOnHand ?? 7 }]];
    }
    return [{ affectedRows: 1 }];
  });
  const connection = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    execute,
  };
  mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });
  return connection;
}

describe('credit-note correction transactions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reverses customer stock and unspent store credit append-only', async () => {
    const connection = connectionFor('customer');

    const result = await reverseCustomerCreditNote({
      businessId: 'biz-1', documentId: 12, reason: 'Entered twice', context, xeroCorrectionRequired: true,
    });

    expect(result).toMatchObject({ id: 12, status: 'reversed', replayed: false, xeroCorrectionStatus: 'queued' });
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("'cn_return_reversed'"),
      ['biz-1', 'v-1', 4, 12, -3, 4, 5.5, 'Entered twice'],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, 'adjust'"),
      [3, -25, 15, 12, 'credit-note-reversal:biz-1:12', 'Reversed CN-00012: Entered twice'],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('blocks source-owned customer credit notes before stock or credit mutation', async () => {
    const connection = connectionFor('customer', { source: 'pos' });

    await expect(reverseCustomerCreditNote({
      businessId: 'biz-1', documentId: 12, reason: 'Wrong return', context, xeroCorrectionRequired: false,
    })).rejects.toThrow('customer credit note cannot perform revert mistaken completion');

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringContaining("'cn_return_reversed'"), expect.anything());
  });

  it('blocks customer reversal when issued credit has been spent', async () => {
    const connection = connectionFor('customer', { contactCredit: 20 });

    await expect(reverseCustomerCreditNote({
      businessId: 'biz-1', documentId: 12, reason: 'Entered twice', context, xeroCorrectionRequired: false,
    })).rejects.toThrow('already spent some of this store credit');

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringContaining("'cn_return_reversed'"), expect.anything());
  });

  it('replays before stock and store-credit side effects', async () => {
    const connection = connectionFor('customer', { operationState: 'complete' });

    const result = await reverseCustomerCreditNote({
      businessId: 'biz-1', documentId: 12, reason: 'Entered twice', context, xeroCorrectionRequired: true,
    });

    expect(result.status).toBe('reversed');
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringContaining('store_credit_transactions'), expect.anything());
    expect(connection.execute).not.toHaveBeenCalledWith(expect.stringContaining("'cn_return_reversed'"), expect.anything());
  });

  it('blocks customer reversal when returned stock is no longer available', async () => {
    const connection = connectionFor('customer', { stockOnHand: 2 });

    await expect(reverseCustomerCreditNote({
      businessId: 'biz-1', documentId: 12, reason: 'Entered twice', context, xeroCorrectionRequired: false,
    })).rejects.toThrow('has 2 on hand but 3 must be removed');

    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it('restores supplier-return stock using the original movement cost', async () => {
    const connection = connectionFor('supplier');

    const result = await reverseSupplierCreditNote({
      businessId: 'biz-1', documentId: 15, reason: 'Supplier return entered twice', context, xeroCorrectionRequired: false,
    });

    expect(result).toMatchObject({ id: 15, status: 'reversed', xeroCorrectionStatus: 'not_required' });
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("'scn_return_reversed'"),
      ['biz-1', 'v-1', 4, 15, 3, 10, 5.5, 'Supplier return entered twice'],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'complete'"),
      expect.arrayContaining(['reversed', 81, 'biz-1']),
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});
