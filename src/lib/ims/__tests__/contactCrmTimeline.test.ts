import { describe, expect, it } from 'vitest';

import { buildContactCrmTimeline } from '../contactCrmTimeline';

describe('buildContactCrmTimeline', () => {
  it('normalizes authoritative sources and orders them newest first', () => {
    const result = buildContactCrmTimeline({
      posSales: [{ id: 4, sale_type: 'return', total: '29.95', status: 'completed', completed_at: '2026-08-18 12:00:00' }],
      salesOrders: [{ id: 3, so_number: 'SO-3', so_type: 'online', total_amount: '55.00', status: 'fulfilled', created_at: '2026-08-17 09:00:00' }],
      creditNotes: [{ id: 2, cn_number: 'CN-2', total_amount: '10.00', status: 'complete', completed_at: '2026-08-16 10:00:00' }],
    });

    expect(result.map(entry => entry.entryKey)).toEqual(['pos-sale:4', 'sales-order:3', 'credit-note:2']);
    expect(result[0]).toMatchObject({ activityType: 'pos_return', amount: -29.95, source: { type: 'pos_sale', id: 4 } });
    expect(result[1]).toMatchObject({ amount: 55, source: { type: 'sales_order', id: 3 } });
    expect(result[2]).toMatchObject({ amount: -10, source: { type: 'credit_note', id: 2 } });
  });

  it('preserves signed loyalty and store-credit ledger meaning', () => {
    const result = buildContactCrmTimeline({
      storeCreditTransactions: [
        { id: 1, type: 'issue', amount: '20', balance_after: '20', created_at: '2026-08-18 09:00:00' },
        { id: 2, type: 'redeem', amount: '5', balance_after: '15', created_at: '2026-08-18 10:00:00' },
        { id: 3, type: 'adjust', amount: '-2', balance_after: '13', created_at: '2026-08-18 11:00:00' },
      ],
      loyaltyTransactions: [{ id: 8, type: 'earn_reversal', points_delta: -15, balance_after: -5, channel: 'shopify', created_at: '2026-08-18 12:00:00' }],
    });

    expect(result.find(entry => entry.entryKey === 'store-credit:1')?.amount).toBe(20);
    expect(result.find(entry => entry.entryKey === 'store-credit:2')?.amount).toBe(-5);
    expect(result.find(entry => entry.entryKey === 'store-credit:3')?.amount).toBe(-2);
    expect(result[0]).toMatchObject({ entryKey: 'loyalty:8', points: -15, summary: 'Balance -5 points' });
  });

  it('emits append-only interactions and task lifecycle events', () => {
    const result = buildContactCrmTimeline({
      interactions: [{ id: 5, interaction_type: 'call', body: 'Discussed winter order', actor_name: 'Alex', occurred_at: '2026-08-15 14:00:00' }],
      tasks: [{ id: 6, title: 'Send range', due_date: '2026-08-16', status: 'completed', created_by_name: 'Alex', created_at: '2026-08-15 15:00:00', completed_by_name: 'Sam', completed_at: '2026-08-16 09:00:00' }],
    });

    expect(result.map(entry => entry.entryKey)).toEqual(['task-completed:6', 'task-created:6', 'interaction:5']);
    expect(result[2]).toMatchObject({ title: 'Call', summary: 'Discussed winter order', actorName: 'Alex' });
  });

  it('applies inclusive dates, categories, limits, and stable tie breaking', () => {
    const result = buildContactCrmTimeline({
      interactions: [
        { id: 1, body: 'Before', created_at: '2026-08-14 23:59:59' },
        { id: 2, body: 'First', created_at: '2026-08-15 10:00:00' },
        { id: 3, body: 'Second', created_at: '2026-08-15 10:00:00' },
        { id: 4, body: 'After', created_at: '2026-08-16 00:00:00' },
      ],
      posSales: [{ id: 9, sale_type: 'sale', total: 1, completed_at: '2026-08-15 12:00:00' }],
    }, { from: '2026-08-15', to: '2026-08-15', categories: ['interaction'], limit: 2 });

    expect(result.map(entry => entry.entryKey)).toEqual(['interaction:3', 'interaction:2']);
  });

  it('handles malformed optional numeric fields without leaking NaN', () => {
    const [entry] = buildContactCrmTimeline({
      salesOrders: [{ id: 7, so_number: null, total_amount: 'invalid', status: null, order_date: '2026-08-18' }],
    });

    expect(entry).toMatchObject({ title: 'Sales order #7', amount: null, status: null });
  });
});