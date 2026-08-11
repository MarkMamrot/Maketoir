import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { getOrderActivityHistory, getOrderAmendmentHistory } from '../orderAmendmentHistory';

describe('getOrderAmendmentHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads completed tenant-scoped operations and normalizes header JSON', async () => {
    mockImsQuery.mockResolvedValueOnce([{
      id: 9,
      order_status: 'confirmed',
      actor_name: 'Alex',
      before_header_json: JSON.stringify({ status: 'confirmed', notes: 'Old', updated_at: 'old' }),
      after_header_json: JSON.stringify({ status: 'cancelled', notes: 'New', updated_at: 'new' }),
      line_change_count: '2',
      created_at: new Date('2026-08-11T10:00:00.000Z'),
      completed_at: new Date('2026-08-11T10:00:01.000Z'),
    }]).mockResolvedValueOnce([{
      id: 12,
      amendment_id: 9,
      source_line_id: 4,
      result_line_id: 4,
      before_line_json: JSON.stringify({ variant_id: 'red', qty_ordered: 5 }),
      after_line_json: JSON.stringify({ variant_id: 'red', qty_ordered: 3 }),
    }, {
      id: 13,
      amendment_id: 9,
      source_line_id: null,
      result_line_id: 8,
      before_line_json: null,
      after_line_json: JSON.stringify({ variant_id: 'blue', qty_ordered: 2 }),
    }]).mockResolvedValueOnce([]);

    await expect(getOrderAmendmentHistory('biz-1', 'purchase_order', 42)).resolves.toEqual([{
      id: 9,
      entryKey: 'amendment:9',
      activityType: 'amendment',
      previousStatus: 'confirmed',
      resultingStatus: 'cancelled',
      actorName: 'Alex',
      lineChangeCount: 2,
      changedFields: ['notes'],
      lines: [{
        id: 12,
        changeType: 'updated',
        variantId: 'red',
        previousQuantity: 5,
        resultingQuantity: 3,
      }, {
        id: 13,
        changeType: 'added',
        variantId: 'blue',
        previousQuantity: null,
        resultingQuantity: 2,
      }],
      createdAt: '2026-08-11T10:00:00.000Z',
      completedAt: '2026-08-11T10:00:01.000Z',
    }]);
    expect(mockImsQuery).toHaveBeenCalledWith(
      expect.stringContaining("operation.state = 'complete'"),
      ['biz-1', 'purchase_order', 42],
    );
    expect(mockImsQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM ims_order_amendment_lines'),
      ['biz-1', 9],
    );
    expect(mockImsQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM ims_po_receive_operations'),
      ['biz-1', 42, 'biz-1', 42],
    );
  });

  it('normalizes receipt and resolution ledgers into safe visible activity', async () => {
    mockImsQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      id: 20,
      activity_type: 'receive',
      state: 'complete',
      request_json: JSON.stringify({ received_items: [{ variant_id: 'red', qty_received: 2 }] }),
      response_json: JSON.stringify({ newStatus: 'complete', backorderPoNumber: 'PO-42-B' }),
      created_at: new Date('2026-08-11T11:00:00.000Z'),
      completed_at: new Date('2026-08-11T11:00:01.000Z'),
    }, {
      id: 21,
      activity_type: 'resolution',
      state: 'complete',
      outcome: 'cancel_remainder',
      settlement: 'supplier_refund',
      request_json: null,
      response_json: '{}',
      created_at: new Date('2026-08-11T12:00:00.000Z'),
      completed_at: new Date('2026-08-11T12:00:01.000Z'),
    }]);

    const entries = await getOrderAmendmentHistory('biz-1', 'purchase_order', 42);

    expect(entries).toMatchObject([{
      entryKey: 'resolution:21',
      activityType: 'resolution',
      title: 'Outstanding quantity cancelled',
      summary: 'Settlement: supplier refund',
    }, {
      entryKey: 'receive:20',
      activityType: 'receive',
      title: 'Receipt completed',
      summary: '1 line submitted; backorder PO-42-B created',
      details: ['Variant red: received 2'],
    }]);
  });

  it('normalizes undo, linked credits, and replacement document links', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{
        id: 30,
        order_status: 'complete',
        actor_name: 'Alex',
        before_header_json: JSON.stringify({ status: 'complete' }),
        after_header_json: JSON.stringify({ status: 'cancelled', correction: 'undo_mistaken_receipt' }),
        line_change_count: 0,
        created_at: new Date('2026-08-12T08:00:00.000Z'),
        completed_at: new Date('2026-08-12T08:00:01.000Z'),
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 61, activity_type: 'credit', document_type: 'supplier_credit_note',
        document_number: 'SCN-0061', state: 'complete', total_amount: 55,
        created_at: new Date('2026-08-12T09:00:00.000Z'), completed_at: new Date('2026-08-12T09:01:00.000Z'),
      }, {
        id: 88, activity_type: 'replacement_child', document_type: 'purchase_order',
        document_number: 'PO-2026-0088', state: 'draft', total_amount: 110,
        created_at: new Date('2026-08-12T10:00:00.000Z'), completed_at: null,
      }]);

    const entries = await getOrderActivityHistory('biz-1', 'purchase_order', 42);

    expect(entries).toMatchObject([{
      activityType: 'replacement', title: 'Replacement Draft created',
      documentType: 'purchase_order', documentId: 88, documentNumber: 'PO-2026-0088',
    }, {
      activityType: 'credit', title: 'Supplier Return / Credit linked',
      documentType: 'supplier_credit_note', documentId: 61, documentNumber: 'SCN-0061',
    }, {
      activityType: 'receipt_undo', title: 'Mistaken receipt undone', state: 'cancelled',
    }]);
    expect(mockImsQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('replacement_of_po_id'),
      ['biz-1', 42, 'biz-1', 42, 'biz-1', 42],
    );
    expect(getOrderAmendmentHistory).toBe(getOrderActivityHistory);
  });
});