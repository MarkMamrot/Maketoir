import { describe, expect, it } from 'vitest';

import { buildCrmAnalytics } from '../contactCrmAnalytics';

describe('CRM analytics', () => {
  it('calculates net CLV, monthly repeat retention, reactivation, and single-task influence attribution', () => {
    const result = buildCrmAnalytics({
      from: '2026-01-01', to: '2026-03-31',
      purchases: [
        { contactId: 1, contactName: 'Jane', occurredAt: '2025-09-01T10:00:00Z', amount: 100, source: 'pos', sourceId: 1 },
        { contactId: 1, contactName: 'Jane', occurredAt: '2026-01-15T10:00:00Z', amount: 80, source: 'pos', sourceId: 2 },
        { contactId: 1, contactName: 'Jane', occurredAt: '2026-01-20T10:00:00Z', amount: -20, source: 'pos', sourceId: 3 },
        { contactId: 2, contactName: 'Alex', occurredAt: '2026-02-10T10:00:00Z', amount: 50, source: 'sales_order', sourceId: 4 },
      ],
      tasks: [{ id: 9, contactId: 1, status: 'completed', createdAt: '2026-01-01', completedAt: '2026-01-10T09:00:00Z', completedBy: 7, completedByName: 'Sam' }],
      interactions: [{ actorId: 7, actorName: 'Sam', occurredAt: '2026-02-01T09:00:00Z' }],
    });
    expect(result.lifetimeValue.total).toBe(210);
    expect(result.retention[0]).toMatchObject({ month: '2026-01', purchasingCustomers: 1, repeatCustomers: 1, retentionRate: 1 });
    expect(result.reactivation).toEqual({ customers: 1, revenue: 80, inactivityDays: 90 });
    expect(result.influenced).toEqual({ revenue: 80, transactions: 1, windowDays: 30 });
    expect(result.advisors[0]).toMatchObject({ name: 'Sam', completedTasks: 1, manualInteractions: 1, influencedRevenue: 80 });
  });

  it('scores stronger frequency and monetary customers higher while better recency scores higher', () => {
    const result = buildCrmAnalytics({
      from: '2026-01-01', to: '2026-03-31', tasks: [], interactions: [],
      purchases: [
        { contactId: 1, contactName: 'Older', occurredAt: '2026-01-01', amount: 10, source: 'pos', sourceId: 1 },
        { contactId: 2, contactName: 'Recent', occurredAt: '2026-03-30', amount: 100, source: 'pos', sourceId: 2 },
        { contactId: 2, contactName: 'Recent', occurredAt: '2026-03-31', amount: 100, source: 'pos', sourceId: 3 },
      ],
    });
    const older = result.rfm.find(row => row.contactId === 1)!;
    const recent = result.rfm.find(row => row.contactId === 2)!;
    expect(recent.recencyScore).toBeGreaterThan(older.recencyScore);
    expect(recent.frequencyScore).toBeGreaterThan(older.frequencyScore);
    expect(recent.monetaryScore).toBeGreaterThan(older.monetaryScore);
  });

  it('does not let completed backlog inflate the task completion rate', () => {
    const result = buildCrmAnalytics({
      from: '2026-01-01', to: '2026-01-31', purchases: [], interactions: [],
      tasks: [
        { id: 1, contactId: 1, status: 'completed', createdAt: '2025-12-01', completedAt: '2026-01-05' },
        { id: 2, contactId: 1, status: 'open', createdAt: '2026-01-10' },
      ],
    });
    expect(result.tasks).toMatchObject({ created: 1, completed: 1, completionRate: 0 });
  });
});