import { describe, expect, it, vi } from 'vitest';
import { createZellerReadiness } from '../zellerReadiness';

describe('terminal readiness', () => {
  it('shares the warm-up with payment and consumes it without another SDK check', async () => {
    let resolve!: (value: boolean) => void;
    const initialise = vi.fn(() => new Promise<boolean>(done => { resolve = done; }));
    const report = vi.fn();
    const ready = createZellerReadiness(initialise, report);
    const warming = ready.prepare();
    const payment = ready.consume();
    await Promise.resolve();
    expect(initialise).toHaveBeenCalledOnce();
    resolve(true);
    expect((await warming).error).toBeNull();
    expect((await payment).error).toBeNull();
    expect(report).toHaveBeenCalledOnce();
    initialise.mockResolvedValue(true);
    await ready.prepare();
    expect(initialise).toHaveBeenCalledTimes(2);
  });

  it('reuses a recent completed preparation exactly once and expires it at 30 seconds', async () => {
    let now = 0;
    const initialise = vi.fn().mockResolvedValue(true);
    const ready = createZellerReadiness(initialise, vi.fn(), () => now);
    await ready.prepare();
    now = 29_999;
    expect((await ready.prepare()).cached).toBe(true);
    expect(initialise).toHaveBeenCalledOnce();
    now = 30_000;
    expect((await ready.prepare()).cached).toBe(false);
    expect(initialise).toHaveBeenCalledTimes(2);
    expect((await ready.consume()).cached).toBe(true);
    await ready.consume();
    expect(initialise).toHaveBeenCalledTimes(3);
  });

  it.each([false, undefined, {}, null])('does not treat an unconfirmed SDK result %s as ready', async result => {
    const ready = createZellerReadiness(vi.fn().mockResolvedValue(result), vi.fn());
    expect((await ready.consume()).error).toBeInstanceOf(Error);
  });

  it('retains SDK errors and allows a later readiness retry, never a purchase', async () => {
    const failure = new Error('Paired Device Not Available');
    const initialise = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(true);
    const ready = createZellerReadiness(initialise, vi.fn());
    expect((await ready.consume()).error).toBe(failure);
    expect((await ready.consume()).error).toBeNull();
  });

  it('rejects a check that completes after the connection or session was invalidated', async () => {
    let resolve!: (value: boolean) => void;
    const initialise = vi.fn(() => new Promise<boolean>(done => { resolve = done; }));
    const ready = createZellerReadiness(initialise, vi.fn());
    const waiting = ready.consume();
    await Promise.resolve();
    ready.invalidate();
    resolve(true);
    expect((await waiting).error).toBeInstanceOf(Error);
    const retry = ready.prepare();
    await Promise.resolve();
    resolve(true);
    expect((await retry).error).toBeNull();
    expect(initialise).toHaveBeenCalledTimes(2);
  });

  it('invalidates a cached result even if session change happens just after consumption begins', async () => {
    const ready = createZellerReadiness(vi.fn().mockResolvedValue(true), vi.fn());
    await ready.prepare();
    const consuming = ready.consume();
    ready.invalidate();
    expect((await consuming).error).toBeInstanceOf(Error);
  });
});
