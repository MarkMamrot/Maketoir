import { describe, expect, it, vi } from 'vitest';
import { runShopifyReconciliationSlice, type ShopifyReconciliationSliceDependencies } from '../shopifyReconciliationSlice';
import type { ReconciliationContinuation } from '../onlineSyncPolicy';

const window = { phase: 'incremental' as const, from: '2026-10-17T00:00:00Z', to: '2026-10-17T01:00:00Z' };
const empty = (): ReconciliationContinuation => ({ window, pageInfo: null, remaining: [], nextPageInfo: null, pageLoaded: false });
const order = (id: number) => ({ id: String(id), updatedAt: '2026-10-17T00:30:00Z' });
function fixture() {
  let state = empty();
  const dependencies = {
    now: vi.fn(() => 0),
    renew: vi.fn(async () => {}),
    save: vi.fn(async (next: ReconciliationContinuation) => { state = JSON.parse(JSON.stringify(next)); }),
    page: vi.fn<ShopifyReconciliationSliceDependencies['page']>(async () => ({ orders: [order(1)], nextPageInfo: null })),
    apply: vi.fn<ShopifyReconciliationSliceDependencies['apply']>(async () => 'applied'),
    complete: vi.fn(async () => {}),
  };
  const run = (remainingBudget = 100, deadline = 45_000) =>
    runShopifyReconciliationSlice({ continuation: state, deadline, remainingBudget }, dependencies);
  return { dependencies, run, state: () => state };
}

describe('bounded Shopify reconciliation slice', () => {
  it('saves discovery before applying and completes a valid empty window', async () => {
    const f = fixture();
    f.dependencies.page.mockResolvedValue({ orders: [], nextPageInfo: null });
    await expect(f.run()).resolves.toEqual({ processed: 0, review: 0, fetchedPages: 1, complete: true });
    expect(f.dependencies.apply).not.toHaveBeenCalled();
    expect(f.dependencies.complete).toHaveBeenCalledWith(expect.objectContaining({ to: '2026-10-17T01:00:00.000Z' }));
    expect(f.dependencies.save.mock.invocationCallOrder[0]).toBeLessThan(f.dependencies.complete.mock.invocationCallOrder[0]);
  });
  it('caps order applications at 25 and resumes the same page without fetching again', async () => {
    const f = fixture();
    f.dependencies.page.mockResolvedValue({ orders: Array.from({ length: 40 }, (_, i) => order(i + 1)), nextPageInfo: null });
    expect((await f.run()).processed).toBe(25);
    expect(f.state().remaining).toHaveLength(15);
    expect((await f.run()).processed).toBe(15);
    expect(f.dependencies.page).toHaveBeenCalledTimes(1);
    expect(f.dependencies.complete).toHaveBeenCalledTimes(1);
    expect(new Set(f.dependencies.apply.mock.calls.map(([reference]) => reference.id)).size).toBe(40);
  });
  it('honours the invocation remainder instead of always doing a full channel slice', async () => {
    const f = fixture();
    f.dependencies.page.mockResolvedValue({ orders: [order(1), order(2)], nextPageInfo: null });
    expect((await f.run(1)).processed).toBe(1);
    expect(f.state().remaining.map(item => item.id)).toEqual(['2']);
    expect(f.dependencies.complete).not.toHaveBeenCalled();
  });
  it('never fetches or applies after the deadline or with zero budget', async () => {
    const f = fixture();
    expect((await f.run(100, 0)).fetchedPages).toBe(0);
    expect((await f.run(0)).processed).toBe(0);
    expect(f.dependencies.renew).not.toHaveBeenCalled();
  });
  it('does not start another application after work consumes the deadline', async () => {
    const f = fixture();
    f.dependencies.page.mockResolvedValue({ orders: [order(1), order(2)], nextPageInfo: null });
    f.dependencies.apply.mockImplementation(async () => { f.dependencies.now.mockReturnValue(45_001); return 'applied'; });
    expect((await f.run()).processed).toBe(1);
    expect(f.state().remaining[0].id).toBe('2');
  });
  it('only fetches one discovery page per slice, including empty pages', async () => {
    const f = fixture();
    f.dependencies.page.mockResolvedValue({ orders: [], nextPageInfo: 'second_page' });
    await expect(f.run()).resolves.toMatchObject({ fetchedPages: 1, complete: false });
    expect(f.state()).toMatchObject({ pageInfo: 'second_page', pageLoaded: false, remaining: [] });
    expect(f.dependencies.complete).not.toHaveBeenCalled();
  });
  it('retains the failed order and fixed interval so a retry cannot skip it', async () => {
    const f = fixture();
    f.dependencies.page.mockResolvedValue({ orders: [order(1), order(2)], nextPageInfo: null });
    f.dependencies.apply.mockRejectedValueOnce(new Error('provider offline'));
    await expect(f.run()).rejects.toThrow('provider offline');
    expect(f.state().remaining.map(item => item.id)).toEqual(['1', '2']);
    const savedWindow = f.state().window;
    await f.run();
    expect(f.state().window).toEqual(savedWindow);
    expect(f.dependencies.apply.mock.calls.map(([reference]) => reference.id)).toEqual(['1', '1', '2']);
  });
  it('requires durable quarantine before accepting a review outcome', async () => {
    const f = fixture();
    f.dependencies.apply.mockResolvedValue('review');
    await expect(f.run()).resolves.toMatchObject({ review: 1, processed: 1, complete: true });
  });
  it('does not complete after losing ownership or a failed checkpoint', async () => {
    const f = fixture();
    f.dependencies.renew.mockRejectedValue(new Error('lost lease'));
    await expect(f.run()).rejects.toThrow('lost lease');
    expect(f.dependencies.page).not.toHaveBeenCalled();
    f.dependencies.renew.mockResolvedValue();
    f.dependencies.save.mockRejectedValue(new Error('database offline'));
    await expect(f.run()).rejects.toThrow('database offline');
    expect(f.dependencies.apply).not.toHaveBeenCalled();
    expect(f.dependencies.complete).not.toHaveBeenCalled();
  });
  it('rejects oversized pages and cyclic pagination instead of looping or dropping rows', async () => {
    const f = fixture();
    f.dependencies.page.mockResolvedValue({ orders: Array.from({ length: 251 }, (_, i) => order(i + 1)), nextPageInfo: null });
    await expect(f.run()).rejects.toThrow('Invalid reconciliation page state');
    f.dependencies.page.mockResolvedValue({ orders: [], nextPageInfo: 'same' });
    await f.run();
    f.dependencies.page.mockResolvedValue({ orders: [], nextPageInfo: 'same' });
    await expect(f.run()).rejects.toThrow('non-advancing');
  });
});
