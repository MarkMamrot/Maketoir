import { describe, expect, it } from 'vitest';

import { PoolTelemetry } from '../dbPoolTelemetry';

describe('PoolTelemetry', () => {
  it('tracks active and queued high-water marks without query data', () => {
    const telemetry = new PoolTelemetry('ims:tenant-hash');

    telemetry.connectionCreated();
    telemetry.acquire(100);
    telemetry.enqueue(110);
    telemetry.enqueue(120);
    telemetry.acquire(160);
    telemetry.release();
    telemetry.retry();
    telemetry.close();

    expect(telemetry.summary()).toEqual({
      pool: 'ims:tenant-hash',
      physicalConnections: 1,
      acquired: 2,
      released: 1,
      enqueued: 2,
      retries: 1,
      closed: 1,
      active: 1,
      activeHighWater: 2,
      queued: 1,
      queuedHighWater: 2,
      queueWaitMsMax: 50,
    });
  });
});