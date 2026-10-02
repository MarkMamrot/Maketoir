import { describe, expect, it, vi } from 'vitest';
import { KlaviyoProfileConflictError } from '../profileReconciliation';
import { processKlaviyoOutbox, type KlaviyoWorkerDependencies } from '../worker';

function dependencies(overrides: Partial<KlaviyoWorkerDependencies> = {}): KlaviyoWorkerDependencies {
  const client = { createEvent: vi.fn(async () => undefined) } as any;
  return {
    getSettings: vi.fn(async () => ({ enabled: true, profilesEnabled: true, reportingEnabled: false,
      sources: { pos: true, nativeShop: false, wholesale: false, shopify: false }, shopifyDuplicateRiskAcknowledged: false })),
    getConnection: vi.fn(async () => ({ klaviyo_api_key: 'encrypted-key' } as any)),
    decryptKey: vi.fn(() => 'private-key'),
    createClient: vi.fn(() => client),
    recoverStale: vi.fn(async () => 1),
    listPending: vi.fn(async () => [{ id: 10, contactId: 42, operationKey: 'pos:order:100:placed:v1',
      source: 'pos', sourceId: '100', eventType: 'Placed Order', attempts: 0,
      event: { metricName: 'Placed Order', uniqueId: 'pos:order:100:placed:v1', occurredAt: '2026-10-02T01:02:03.000Z',
        properties: { OrderId: '100' }, value: 109.95, valueCurrency: 'AUD' } }] as any),
    claim: vi.fn(async () => true),
    reconcileProfile: vi.fn(async () => ({ id: 'profile-1' } as any)),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    reportIssue: vi.fn(async () => null),
    ...overrides,
  };
}

describe('Klaviyo outbox worker', () => {
  it('reconciles the current profile and sends a claimed event once', async () => {
    const deps = dependencies();

    await expect(processKlaviyoOutbox({ businessId: 'business-1' }, deps)).resolves.toEqual({
      processed: 1, sent: 1, skipped: 0, failed: 0, recovered: 1,
    });
    expect(deps.reconcileProfile).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', contactId: 42 }));
    const client = vi.mocked(deps.createClient).mock.results[0].value;
    expect(client.createEvent).toHaveBeenCalledWith(expect.objectContaining({ profile: { id: 'profile-1' } }));
    expect(deps.complete).toHaveBeenCalledWith('business-1', 10);
  });

  it('marks disabled sources complete without sending', async () => {
    const deps = dependencies({ getSettings: vi.fn(async () => ({ enabled: true, profilesEnabled: true, reportingEnabled: false,
      sources: { pos: false, nativeShop: false, wholesale: false, shopify: false }, shopifyDuplicateRiskAcknowledged: false })) });

    const result = await processKlaviyoOutbox({ businessId: 'business-1' }, deps);

    expect(result.skipped).toBe(1);
    expect(deps.reconcileProfile).not.toHaveBeenCalled();
    expect(deps.complete).toHaveBeenCalledWith('business-1', 10, 'Klaviyo source pos is disabled.');
  });

  it('dead-letters profile conflicts and reports safe context', async () => {
    const deps = dependencies({ reconcileProfile: vi.fn(async () => { throw new KlaviyoProfileConflictError('Profile conflict'); }) });

    const result = await processKlaviyoOutbox({ businessId: 'business-1' }, deps);

    expect(result.failed).toBe(1);
    expect(deps.fail).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', id: 10, retry: false, retryDelaySeconds: 30 }));
    expect(deps.reportIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', source: 'klaviyo.outbox', operation: 'send_event',
      context: { source: 'pos', eventType: 'Placed Order', attempt: 1, retry: false },
    }));
  });

  it('retries transient failures with bounded backoff', async () => {
    const deps = dependencies({ reconcileProfile: vi.fn(async () => { throw new Error('Klaviyo unavailable'); }) });

    await processKlaviyoOutbox({ businessId: 'business-1' }, deps);

    expect(deps.fail).toHaveBeenCalledWith(expect.objectContaining({ retry: true, retryDelaySeconds: 30 }));
  });
});