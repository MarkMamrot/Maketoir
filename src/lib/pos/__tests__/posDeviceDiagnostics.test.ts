import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSlowTerminalStart, startTerminalTiming, reportPosDeviceIssue } from '../posDeviceDiagnostics';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('terminal timing', () => {
  it('captures long tasks and always disconnects, even when final sampling fails', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let callback: PerformanceObserverCallback;
    const disconnect = vi.fn();
    const takeRecords = vi.fn(() => [{ duration: 250 }]);
    class Observer {
      static supportedEntryTypes = ['longtask'];
      constructor(cb: PerformanceObserverCallback) { callback = cb; }
      observe = vi.fn();
      disconnect = disconnect;
      takeRecords = takeRecords;
    }
    vi.stubGlobal('PerformanceObserver', Observer);
    const timing = startTerminalTiming(() => 0);
    callback!({ getEntries: () => [{ duration: 150 }] } as PerformanceObserverEntryList, {} as PerformanceObserver);
    expect(timing.finish()).toMatchObject({ longTaskCount: 2, longTaskTotalMs: 400, maxLongTaskMs: 250, longTaskSupported: true });
    expect(disconnect).toHaveBeenCalledOnce();
    takeRecords.mockImplementation(() => { throw new Error('Sampling unavailable'); });
    const broken = startTerminalTiming(() => 0);
    expect(() => broken.finish()).not.toThrow();
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disconnects a partially started observer and does not prevent payment timing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const disconnect = vi.fn();
    class Observer {
      static supportedEntryTypes = ['longtask'];
      observe() { throw new Error('Observer unavailable'); }
      disconnect = disconnect;
    }
    vi.stubGlobal('PerformanceObserver', Observer);
    const timing = startTerminalTiming(() => 0);
    expect(timing.finish().longTaskSupported).toBe(false);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('separates readiness and first terminal event from human interaction and cleans up once', () => {
    vi.useFakeTimers();
    vi.stubGlobal('PerformanceObserver', undefined);
    let now = 0;
    const timing = startTerminalTiming(() => now);
    now = 120;
    timing.readiness({ checkMs: 800, cached: true });
    timing.sent();
    now = 300;
    timing.terminalEvent();
    now = 30_000;
    const metrics = timing.finish();
    expect(metrics).toMatchObject({
      readinessWaitMs: 120, readinessCheckMs: 800, readinessCached: true,
      firstTerminalEventMs: 180, resultWaitMs: 29_880, longTaskSupported: false,
    });
    expect(isSlowTerminalStart(metrics)).toBe(false);
    now = 50_000;
    expect(timing.finish()).toBe(metrics);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('measures an event-loop stall and handles unsupported long-task sampling explicitly', () => {
    vi.useFakeTimers();
    vi.stubGlobal('PerformanceObserver', undefined);
    let now = 0;
    const timing = startTerminalTiming(() => now);
    now = 800;
    vi.advanceTimersByTime(100);
    const metrics = timing.finish();
    expect(metrics.maxEventLoopDelayMs).toBe(700);
    expect(isSlowTerminalStart(metrics)).toBe(true);
  });

  it('checks exact delay thresholds, not total time awaiting card or PIN', () => {
    const timing = startTerminalTiming(() => 0);
    const metrics = timing.finish();
    expect(isSlowTerminalStart({ ...metrics, readinessWaitMs: 1_999, resultWaitMs: 90_000 })).toBe(false);
    expect(isSlowTerminalStart({ ...metrics, readinessWaitMs: 2_000 })).toBe(true);
    expect(isSlowTerminalStart({ ...metrics, firstTerminalEventMs: 2_000 })).toBe(true);
    expect(isSlowTerminalStart({ ...metrics, maxLongTaskMs: 200 })).toBe(true);
    expect(isSlowTerminalStart({ ...metrics, maxEventLoopDelayMs: 500 })).toBe(true);
    expect(isSlowTerminalStart({ ...metrics, readinessWaitMs: 60_000, pageWasHidden: true })).toBe(false);
  });

  it('only sends safe numeric diagnostics to the originating business', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    reportPosDeviceIssue('pos_terminal_delay', 'Slow preparation', 'original-business', { readinessWaitMs: 2_500 });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      operation: 'pos_terminal_delay', message: 'Slow preparation', businessId: 'original-business',
      pathname: '/pos', metrics: { readinessWaitMs: 2_500 },
    });
  });
});
