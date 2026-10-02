import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ imsExecute: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => mocks);

import { enqueueKlaviyoEvents } from '../outboxRepository';

describe('Klaviyo outbox repository', () => {
  beforeEach(() => mocks.imsExecute.mockReset());

  it('enqueues deterministic events without storing profile identifiers', async () => {
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });

    const inserted = await enqueueKlaviyoEvents({
      businessId: 'business-1',
      contactId: 42,
      source: 'pos',
      sourceId: '100',
      events: [{
        metricName: 'Placed Order',
        profile: { email: 'customer@example.com', externalId: 'solvantis:business-1:contact:42' },
        uniqueId: 'pos:order:100:placed:v1',
        occurredAt: '2026-10-02T01:02:03.456Z',
        properties: { OrderId: '100' },
        value: 109.95,
        valueCurrency: 'AUD',
      }],
    });

    expect(inserted).toBe(1);
    const [sql, params] = mocks.imsExecute.mock.calls[0];
    expect(sql).toContain('INSERT IGNORE INTO ims_klaviyo_outbox');
    expect(params.slice(0, 8)).toEqual([
      'business-1', 42, 'pos:order:100:placed:v1', 'pos', '100', 'Placed Order', 1,
      '2026-10-02 01:02:03.456',
    ]);
    expect(JSON.parse(params[8])).toEqual({
      metricName: 'Placed Order',
      uniqueId: 'pos:order:100:placed:v1',
      occurredAt: '2026-10-02T01:02:03.456Z',
      properties: { OrderId: '100' },
      value: 109.95,
      valueCurrency: 'AUD',
    });
  });

  it('reports duplicate operation keys as not inserted', async () => {
    mocks.imsExecute.mockResolvedValue({ affectedRows: 0 });

    await expect(enqueueKlaviyoEvents({
      businessId: 'business-1',
      contactId: 42,
      source: 'pos',
      sourceId: '100',
      events: [{
        metricName: 'Placed Order', profile: { externalId: 'contact-42' },
        uniqueId: 'pos:order:100:placed:v1', occurredAt: '2026-10-02T01:02:03.000Z', properties: {},
      }],
    })).resolves.toBe(0);
  });
});