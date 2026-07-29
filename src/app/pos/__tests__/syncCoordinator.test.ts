import { describe, expect, it, vi } from 'vitest';
import { createPosSyncCoordinator } from '../_syncCoordinator';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createPosSyncCoordinator', () => {
  it('coalesces overlapping background syncs onto one request', async () => {
    const coordinator = createPosSyncCoordinator();
    const active = deferred();
    const firstTask = vi.fn(() => active.promise);
    const overlappingTask = vi.fn(async () => {});

    const first = coordinator.run(firstTask);
    const overlapping = coordinator.run(overlappingTask);
    await Promise.resolve();

    expect(firstTask).toHaveBeenCalledOnce();
    expect(overlappingTask).not.toHaveBeenCalled();
    active.resolve();
    await expect(Promise.all([first, overlapping])).resolves.toEqual([undefined, undefined]);
  });

  it('queues one full sync behind an active incremental sync', async () => {
    const coordinator = createPosSyncCoordinator();
    const incremental = deferred();
    const fullTask = vi.fn(async () => {});

    const first = coordinator.run(() => incremental.promise);
    const queuedFull = coordinator.run(fullTask, true);
    const duplicateFull = coordinator.run(vi.fn(async () => {}), true);
    await Promise.resolve();

    expect(fullTask).not.toHaveBeenCalled();
    incremental.resolve();
    await first;
    await expect(Promise.all([queuedFull, duplicateFull])).resolves.toEqual([undefined, undefined]);
    expect(fullTask).toHaveBeenCalledOnce();
  });

  it('still runs a queued full sync when the incremental request fails', async () => {
    const coordinator = createPosSyncCoordinator();
    const incremental = deferred();
    const fullTask = vi.fn(async () => {});

    const first = coordinator.run(() => incremental.promise);
    const queuedFull = coordinator.run(fullTask, true);
    incremental.reject(new Error('network failed'));

    await expect(first).rejects.toThrow('network failed');
    await expect(queuedFull).resolves.toBeUndefined();
    expect(fullTask).toHaveBeenCalledOnce();
  });
});
