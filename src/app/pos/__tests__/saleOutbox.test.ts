import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addToOfflineQueue, drainOfflineQueue, loadFailedQueue, loadLastCompletedSale,
  loadOfflineQueue, retryFailedQueue, saveDeviceConfig,
} from '../_store';
import { canCompleteSaleLocally, recordLocalSale } from '../_localSale';
import type { CompletedSale } from '../_types';

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(), getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); }, setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function receipt(localId: string): CompletedSale {
  return {
    id: null, local_id: localId, location_name: 'Store', cashier_name: 'Cashier',
    sale_type: 'sale', status: 'completed', items: [], payments: [],
    subtotal: 11, discount_total: 0, tax_total: 1, total: 11, created_at: new Date().toISOString(),
  };
}

function acknowledgement(id = 1) {
  return new Response(JSON.stringify({ success: true, id }), { status: 200 });
}

let businessNumber = 0;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(acknowledgement());
  saveDeviceConfig({ business_id: `outbox-${++businessNumber}`, location_id: 1, location_name: 'Store', register_id: 1, register_name: 'Till' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('local-first sale completion', () => {
  it('returns a printable, durable receipt without starting or waiting for any HTTP request', () => {
    const sale = recordLocalSale({ local_id: 'paid', payments: [{ reference: 'approved-tx' }] }, receipt('paid'));
    expect(sale.sync_status).toBe('pending');
    expect(loadOfflineQueue()[0].receipt).toEqual(sale);
    expect(loadLastCompletedSale()).toEqual(sale);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the approved sale in memory and exposes storage failure without blocking the receipt', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    const sale = recordLocalSale({ local_id: 'quota-sale' }, receipt('quota-sale'));
    expect(sale.sync_status).toBe('storage_failed');
    expect(loadOfflineQueue()[0].payload).toEqual({ local_id: 'quota-sale' });
    expect(loadLastCompletedSale()?.sync_status).toBe('storage_failed');
    expect(fetchMock).toHaveBeenCalledWith('/api/runtime-issues/client', expect.objectContaining({
      body: expect.stringContaining('pos_sale_local_storage'),
    }));
    vi.restoreAllMocks();
    await drainOfflineQueue();
    expect(loadOfflineQueue()).toEqual([]);
    expect(loadLastCompletedSale()?.sync_status).toBe('synced');
  });

  it('reuses a recorded snapshot when completion repeats with the same payment-derived ID', () => {
    const first = recordLocalSale({ local_id: 'zeller:approved' }, receipt('zeller:approved'));
    const second = recordLocalSale({ local_id: 'zeller:approved', total: 999 }, { ...first, total: 999 });
    expect(second).toEqual(first);
    expect(loadOfflineQueue()).toHaveLength(1);
  });

  it('does not apply local-success semantics to balance-sensitive or server-authorised sales', () => {
    const ordinary = { training: false, layby: false, reward: false, linkedReturn: false, buildRequired: false,
      items: [{ qty: 1 }], payments: [{ method: 'Card' }] };
    expect(canCompleteSaleLocally(ordinary)).toBe(true);
    for (const flag of ['training', 'layby', 'reward', 'linkedReturn', 'buildRequired']) {
      expect(canCompleteSaleLocally({ ...ordinary, [flag]: true })).toBe(false);
    }
    expect(canCompleteSaleLocally({ ...ordinary, items: [{ qty: -1 }] })).toBe(false);
    expect(canCompleteSaleLocally({ ...ordinary, items: [{ qty: 1, is_gift_card: true }] })).toBe(false);
    for (const method of ['Gift Card', 'Gift Card (Issue)', 'Store Credit', 'Store Credit (Issue)']) {
      expect(canCompleteSaleLocally({ ...ordinary, payments: [{ method }] })).toBe(false);
    }
  });
});

describe('durable sale uploads', () => {
  it('reports an in-flight rejection against its original business after a device switch', async () => {
    const originalDevice = JSON.parse(localStorage.getItem('pos_device_config')!);
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    addToOfflineQueue({ local_id: 'rejected-old-business' });
    const uploading = drainOfflineQueue();
    saveDeviceConfig({ ...originalDevice, business_id: 'switched-business' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    finish(new Response(JSON.stringify({ error: 'Requires review' }), { status: 400 }));
    await uploading;
    const report = fetchMock.mock.calls.find(([url]) => url === '/api/runtime-issues/client');
    expect(JSON.parse(String(report?.[1]?.body))).toMatchObject({
      operation: 'pos_sale_sync', localId: 'rejected-old-business', businessId: originalDevice.business_id,
    });
    expect(loadFailedQueue()).toEqual([]);
    saveDeviceConfig(originalDevice);
    expect(loadFailedQueue()).toHaveLength(1);
  });
  it('does not overwrite a newly recorded sale when an older upload finishes', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    addToOfflineQueue({ local_id: 'old' });
    const uploading = drainOfflineQueue();
    addToOfflineQueue({ local_id: 'new' });
    finish(acknowledgement());
    await uploading;
    expect(loadOfflineQueue().map(entry => entry.payload)).toEqual([{ local_id: 'new' }]);
    await drainOfflineQueue();
    expect(loadOfflineQueue()).toEqual([]);
  });

  it('shares one active upload between overlapping drain calls', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    addToOfflineQueue({ local_id: 'one' });
    const first = drainOfflineQueue();
    const second = drainOfflineQueue();
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(acknowledgement());
    await first;
  });

  it('never stores the result in another tenant or starts another old-tenant request after switching', async () => {
    const originalDevice = JSON.parse(localStorage.getItem('pos_device_config')!);
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    recordLocalSale({ local_id: 'first' }, receipt('first'));
    addToOfflineQueue({ local_id: 'second' });
    const uploading = drainOfflineQueue();
    saveDeviceConfig({ ...originalDevice, business_id: 'another-business' });
    finish(acknowledgement());
    await uploading;
    expect(loadOfflineQueue()).toEqual([]);
    expect(loadLastCompletedSale()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).business_id).toBe(originalDevice.business_id);
    saveDeviceConfig(originalDevice);
    expect(loadOfflineQueue()).toHaveLength(1);
    expect(loadLastCompletedSale()?.id).toBe(1);
  });

  it('aborts a stalled upload after 15 seconds and retains the paid sale for retry', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
    }));
    addToOfflineQueue({ local_id: 'stalled' });
    const uploading = drainOfflineQueue();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(loadOfflineQueue()[0].attempts).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await uploading;
    expect(loadOfflineQueue()[0].attempts).toBe(1);
    expect(loadFailedQueue()).toEqual([]);
    await drainOfflineQueue();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await drainOfflineQueue();
    expect(loadOfflineQueue()).toEqual([]);
  });

  it('requires a real acknowledgement, not just HTTP 200, before deleting a sale', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    addToOfflineQueue({ local_id: 'no-ack' });
    await drainOfflineQueue();
    expect(loadOfflineQueue()).toHaveLength(1);
  });

  it('preserves rejected sales for explicit review and retry with the same local ID', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Needs review' }), { status: 409 }));
    recordLocalSale({ local_id: 'rejected' }, receipt('rejected'));
    await drainOfflineQueue();
    expect(loadOfflineQueue()).toEqual([]);
    expect(loadFailedQueue()[0].payload).toEqual({ local_id: 'rejected' });
    expect(loadLastCompletedSale()?.sync_status).toBe('needs_review');
    retryFailedQueue();
    await drainOfflineQueue();
    expect(loadFailedQueue()).toEqual([]);
    expect(loadLastCompletedSale()?.sync_status).toBe('synced');
  });

  it('migrates legacy live and failed queues without losing either', () => {
    const businessId = JSON.parse(localStorage.getItem('pos_device_config')!).business_id;
    localStorage.setItem(`pos_offline_queue:${businessId}`, JSON.stringify([{ payload: { local_id: 'legacy' }, attempts: 2, queued_at: '2026-10-14T00:00:00Z' }]));
    localStorage.setItem(`pos_failed_queue:${businessId}`, JSON.stringify([{ payload: { local_id: 'legacy-failed' }, attempts: 5, queued_at: '2026-10-14T00:00:00Z' }]));
    expect(loadOfflineQueue()[0].attempts).toBe(2);
    expect(loadFailedQueue()[0].attempts).toBe(5);
    expect(localStorage.getItem(`pos_offline_queue:${businessId}`)).toBeNull();
    expect(localStorage.getItem(`pos_failed_queue:${businessId}`)).toBeNull();
  });

  it('leaves legacy storage intact if migration cannot be persisted', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const businessId = JSON.parse(localStorage.getItem('pos_device_config')!).business_id;
    const oldKey = `pos_offline_queue:${businessId}`;
    localStorage.setItem(oldKey, JSON.stringify([{ payload: { local_id: 'legacy-full' }, attempts: 0, queued_at: '2026-10-14T00:00:00Z' }]));
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    expect(() => loadOfflineQueue()).toThrow();
    expect(() => loadOfflineQueue()).toThrow();
    expect(localStorage.getItem(oldKey)).not.toBeNull();
  });
});
