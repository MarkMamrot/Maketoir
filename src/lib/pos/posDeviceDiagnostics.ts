'use client';

export interface TerminalTimingMetrics {
  readinessWaitMs: number;
  readinessCheckMs: number;
  readinessCached: boolean;
  firstTerminalEventMs: number | null;
  resultWaitMs: number | null;
  totalMs: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  maxLongTaskMs: number;
  maxEventLoopDelayMs: number;
  longTaskSupported: boolean;
  pageWasHidden: boolean;
  jsHeapBytes: number | null;
}

export function reportPosDeviceIssue(
  operation: 'pos_terminal_readiness' | 'pos_terminal_delay' | 'pos_terminal_purchase' | 'pos_terminal_refund' | 'pos_audio_playback',
  message: string,
  businessId?: string,
  metrics?: Partial<TerminalTimingMetrics>,
): void {
  console.error(`[POS] ${operation}`, message, metrics ?? '');
  if (!businessId) return;
  void Promise.resolve().then(() => fetch('/api/runtime-issues/client', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ operation, message, businessId, metrics, pathname: '/pos' }),
  })).then(response => {
    if (!response.ok) throw new Error(`POS device diagnostics returned HTTP ${response.status}.`);
  }).catch(error => { console.error('[POS] Could not persist device diagnostics', error); });
}

export function startTerminalTiming(now: () => number = () => performance.now(), businessId?: string) {
  const started = now();
  let sentAt: number | undefined;
  let firstEventAt: number | undefined;
  let readinessWaitMs = 0;
  let readinessCheckMs = 0;
  let readinessCached = false;
  let longTaskCount = 0;
  let longTaskTotalMs = 0;
  let maxLongTaskMs = 0;
  let maxEventLoopDelayMs = 0;
  let finished = false;
  let snapshot: TerminalTimingMetrics | undefined;
  let lastTick = started;
  let pageWasHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const visibilityChanged = () => { if (document.visibilityState === 'hidden') pageWasHidden = true; };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibilityChanged);
  const timer = setInterval(() => {
    const current = now();
    maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, current - lastTick - 100);
    lastTick = current;
  }, 100);
  const recordTasks = (entries: PerformanceEntry[]) => {
    for (const entry of entries) {
      longTaskCount++;
      longTaskTotalMs += entry.duration;
      maxLongTaskMs = Math.max(maxLongTaskMs, entry.duration);
    }
  };
  let longTaskSupported = false;
  let observer: PerformanceObserver | undefined;
  try {
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      observer = new PerformanceObserver(list => recordTasks(list.getEntries()));
      observer.observe({ entryTypes: ['longtask'] });
      longTaskSupported = true;
    }
  } catch {
    try { observer?.disconnect(); }
    catch { reportPosDeviceIssue('pos_terminal_delay', 'Browser long-task diagnostics could not disconnect after setup failed.', businessId); }
    observer = undefined;
    reportPosDeviceIssue('pos_terminal_delay', 'Browser long-task diagnostics could not start. Payment handling is unchanged.', businessId);
  }

  return {
    readiness(check: { checkMs: number; cached: boolean }) {
      readinessWaitMs = now() - started;
      readinessCheckMs = check.checkMs;
      readinessCached = check.cached;
    },
    sent() { sentAt = now(); },
    terminalEvent() { if (!finished && firstEventAt === undefined) firstEventAt = now(); },
    finish(): TerminalTimingMetrics {
      if (snapshot) return snapshot;
      finished = true;
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityChanged);
      if (observer) {
        try { recordTasks(observer.takeRecords()); }
        catch { reportPosDeviceIssue('pos_terminal_delay', 'Browser long-task diagnostics could not finish. Payment handling is unchanged.', businessId); }
        try { observer.disconnect(); }
        catch { reportPosDeviceIssue('pos_terminal_delay', 'Browser long-task diagnostics could not disconnect. Payment handling is unchanged.', businessId); }
      }
      let jsHeapBytes: number | null = null;
      try {
        if ('memory' in performance && performance.memory && typeof performance.memory === 'object'
          && 'usedJSHeapSize' in performance.memory && typeof performance.memory.usedJSHeapSize === 'number') {
          jsHeapBytes = performance.memory.usedJSHeapSize;
        }
      } catch {
        reportPosDeviceIssue('pos_terminal_delay', 'Browser memory diagnostics were unavailable. Payment handling is unchanged.', businessId);
      }
      const elapsed = (value: number) => Math.max(0, Math.round(value));
      const ended = now();
      snapshot = {
        readinessWaitMs: elapsed(readinessWaitMs), readinessCheckMs: elapsed(readinessCheckMs), readinessCached,
        firstTerminalEventMs: firstEventAt === undefined || sentAt === undefined ? null : elapsed(firstEventAt - sentAt),
        resultWaitMs: sentAt === undefined ? null : elapsed(ended - sentAt), totalMs: elapsed(ended - started),
        longTaskCount, longTaskTotalMs: elapsed(longTaskTotalMs), maxLongTaskMs: elapsed(maxLongTaskMs),
        maxEventLoopDelayMs: elapsed(maxEventLoopDelayMs), longTaskSupported, pageWasHidden, jsHeapBytes,
      };
      return snapshot;
    },
  };
}

export function isSlowTerminalStart(metrics: TerminalTimingMetrics): boolean {
  return !metrics.pageWasHidden && (metrics.readinessWaitMs >= 2_000
    || (metrics.firstTerminalEventMs !== null && metrics.firstTerminalEventMs >= 2_000)
    || metrics.maxLongTaskMs >= 200 || metrics.maxEventLoopDelayMs >= 500);
}
