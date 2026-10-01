import type { Pool } from 'mysql2/promise';

interface PoolTelemetrySummary {
  pool: string;
  physicalConnections: number;
  acquired: number;
  released: number;
  enqueued: number;
  retries: number;
  closed: number;
  active: number;
  activeHighWater: number;
  queued: number;
  queuedHighWater: number;
  queueWaitMsMax: number;
}

export class PoolTelemetry {
  private physicalConnections = 0;
  private acquired = 0;
  private released = 0;
  private enqueued = 0;
  private retries = 0;
  private closed = 0;
  private active = 0;
  private activeHighWater = 0;
  private queued = 0;
  private queuedHighWater = 0;
  private queueWaitMsMax = 0;
  private readonly queuedAt: number[] = [];

  constructor(private readonly label: string) {}

  connectionCreated(): void {
    this.physicalConnections += 1;
  }

  acquire(now = Date.now()): void {
    this.acquired += 1;
    this.active += 1;
    this.activeHighWater = Math.max(this.activeHighWater, this.active);
    const queuedAt = this.queuedAt.shift();
    if (queuedAt !== undefined) {
      this.queued = Math.max(0, this.queued - 1);
      this.queueWaitMsMax = Math.max(this.queueWaitMsMax, now - queuedAt);
    }
  }

  enqueue(now = Date.now()): void {
    this.enqueued += 1;
    this.queued += 1;
    this.queuedHighWater = Math.max(this.queuedHighWater, this.queued);
    this.queuedAt.push(now);
  }

  release(): void {
    this.released += 1;
    this.active = Math.max(0, this.active - 1);
  }

  retry(): void {
    this.retries += 1;
  }

  close(): void {
    this.closed += 1;
  }

  summary(): PoolTelemetrySummary {
    return {
      pool: this.label,
      physicalConnections: this.physicalConnections,
      acquired: this.acquired,
      released: this.released,
      enqueued: this.enqueued,
      retries: this.retries,
      closed: this.closed,
      active: this.active,
      activeHighWater: this.activeHighWater,
      queued: this.queued,
      queuedHighWater: this.queuedHighWater,
      queueWaitMsMax: this.queueWaitMsMax,
    };
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __dbPoolTelemetry: Map<string, PoolTelemetry> | undefined;
  // eslint-disable-next-line no-var
  var __dbPoolTelemetryTimer: ReturnType<typeof setInterval> | undefined;
}

const telemetry = globalThis.__dbPoolTelemetry
  ?? (globalThis.__dbPoolTelemetry = new Map<string, PoolTelemetry>());

function getTelemetry(label: string): PoolTelemetry {
  const item = telemetry.get(label) ?? new PoolTelemetry(label);
  telemetry.set(label, item);
  return item;
}

function ensureSummaryTimer(): void {
  if (globalThis.__dbPoolTelemetryTimer) return;
  const intervalMs = Math.max(10000, parseInt(process.env.DB_POOL_TELEMETRY_INTERVAL_MS ?? '60000', 10) || 60000);
  globalThis.__dbPoolTelemetryTimer = setInterval(() => {
    for (const item of telemetry.values()) {
      const summary = item.summary();
      if (summary.acquired > 0 || summary.enqueued > 0 || summary.retries > 0) {
        console.info('[db-pool]', JSON.stringify(summary));
      }
    }
  }, intervalMs);
  globalThis.__dbPoolTelemetryTimer.unref?.();
}

export function instrumentPool(pool: Pool, label: string): PoolTelemetry {
  const item = getTelemetry(label);
  ensureSummaryTimer();
  pool.on('connection', () => item.connectionCreated());
  pool.on('acquire', () => item.acquire());
  pool.on('enqueue', () => item.enqueue());
  pool.on('release', () => item.release());
  return item;
}

export function recordPoolRetry(label: string): void {
  getTelemetry(label).retry();
}

export function recordPoolClose(label: string): void {
  getTelemetry(label).close();
}