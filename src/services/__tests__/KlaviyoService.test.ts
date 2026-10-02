import { describe, expect, it, vi } from 'vitest';
import { KlaviyoService } from '../KlaviyoService';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('KlaviyoService', () => {
  it('follows collection pagination and normalizes campaign records', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'campaign-1', attributes: { name: 'Launch', status: 'Sent', archived: false } }],
        links: { next: 'https://a.klaviyo.com/api/campaigns/?page[cursor]=next' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'campaign-2', attributes: { name: 'Reminder', status: 'Draft', archived: true } }],
        links: { next: null },
      }));
    const service = new KlaviyoService('private-key', { fetcher });

    const campaigns = await service.getCampaigns();

    expect(campaigns).toHaveLength(2);
    expect(campaigns[0]).toEqual(expect.objectContaining({
      id: 'campaign-1',
      name: 'Launch',
      status: 'Sent',
      archived: 'false',
    }));
    expect(campaigns[1].archived).toBe('true');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain('page[cursor]=next');
  });

  it('sends the configured API revision and does not expose the key in the URL', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ data: [], links: { next: null } }));
    const service = new KlaviyoService('private-key', { fetcher, revision: '2026-01-15' });

    await service.getLists();

    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).not.toContain('private-key');
    expect(init.headers).toMatchObject({
      Authorization: 'Klaviyo-API-Key private-key',
      revision: '2026-01-15',
    });
  });

  it('retries rate-limited requests using Retry-After', async () => {
    const sleeper = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ errors: [{ detail: 'Slow down' }] }, 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse({ data: [], links: { next: null } }));
    const service = new KlaviyoService('private-key', { fetcher, sleeper });

    await service.getFlows();

    expect(sleeper).toHaveBeenCalledWith(2_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('surfaces structured API errors after bounded retries', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({ errors: [{ detail: 'Missing flows:read scope' }] }, 403),
    );
    const service = new KlaviyoService('private-key', { fetcher });

    await expect(service.getFlows()).rejects.toThrow('Klaviyo request failed: Missing flows:read scope');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('creates an idempotent backfill event with stable profile identity', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const service = new KlaviyoService('private-key', { fetcher });

    await service.createEvent({
      metricName: 'Placed Order',
      profile: { email: 'customer@example.com', externalId: 'solvantis:business-1:contact:42' },
      uniqueId: 'pos:sale-100:placed-order:v1',
      occurredAt: '2026-10-02T01:02:03.000Z',
      properties: { orderId: 'sale-100', channel: 'pos' },
      value: 109.95,
      valueCurrency: 'AUD',
      backfill: true,
    });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://a.klaviyo.com/api/events');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Klaviyo-API-Key private-key',
        'Content-Type': 'application/vnd.api+json',
        revision: '2026-07-15',
      },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      data: {
        type: 'event',
        attributes: {
          properties: { orderId: 'sale-100', channel: 'pos' },
          time: '2026-10-02T01:02:03.000Z',
          unique_id: 'pos:sale-100:placed-order:v1',
          value: 109.95,
          value_currency: 'AUD',
          backfill: true,
          metric: { data: { type: 'metric', attributes: { name: 'Placed Order' } } },
          profile: {
            data: {
              type: 'profile',
              attributes: {
                email: 'customer@example.com',
                external_id: 'solvantis:business-1:contact:42',
              },
            },
          },
        },
      },
    });
  });

  it('finds a profile by an encoded external identity', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ id: 'profile-1', attributes: { email: 'customer@example.com', external_id: 'contact:42' } }],
      links: { next: null },
    }));
    const service = new KlaviyoService('private-key', { fetcher });

    await expect(service.findProfilesByIdentifier('external_id', 'contact:42')).resolves.toEqual([{
      id: 'profile-1', email: 'customer@example.com', externalId: 'contact:42',
    }]);
    expect(fetcher.mock.calls[0][0]).toContain('filter=equals%28external_id%2C%22contact%3A42%22%29');
  });

  it('creates and updates profiles without subscription attributes', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'profile-1', attributes: { external_id: 'contact:42' } } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'profile-1', attributes: { email: 'new@example.com', external_id: 'contact:42' } } }));
    const service = new KlaviyoService('private-key', { fetcher });

    await service.createProfile({ email: 'customer@example.com', externalId: 'contact:42' });
    await service.updateProfile('profile-1', { email: 'new@example.com', externalId: 'contact:42' });

    const createBody = JSON.parse(String(fetcher.mock.calls[0][1].body));
    const updateBody = JSON.parse(String(fetcher.mock.calls[1][1].body));
    expect(createBody.data.attributes).toEqual({ email: 'customer@example.com', external_id: 'contact:42' });
    expect(updateBody.data).toEqual({
      type: 'profile', id: 'profile-1', attributes: { email: 'new@example.com', external_id: 'contact:42' },
    });
    expect(JSON.stringify([createBody, updateBody])).not.toContain('subscription');
  });
});