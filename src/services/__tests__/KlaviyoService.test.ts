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
});