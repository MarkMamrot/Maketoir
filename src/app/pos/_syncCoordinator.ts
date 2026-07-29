type SyncTask = () => Promise<void>;

export interface PosSyncCoordinator {
  run(task: SyncTask, forceFull?: boolean): Promise<void>;
}

/**
 * Coalesces background sync triggers while preserving an explicit full sync.
 * Timer/focus/mount callers share the active request; a manual full sync that
 * arrives during an incremental request is queued once and runs immediately
 * afterward.
 */
export function createPosSyncCoordinator(): PosSyncCoordinator {
  let inFlight: Promise<void> | null = null;
  let inFlightIsFull = false;
  let queuedFull: Promise<void> | null = null;

  function start(task: SyncTask, forceFull: boolean): Promise<void> {
    inFlightIsFull = forceFull;
    const operation = Promise.resolve().then(task);
    let tracked: Promise<void>;
    tracked = operation.finally(() => {
      if (inFlight === tracked) {
        inFlight = null;
        inFlightIsFull = false;
      }
    });
    inFlight = tracked;
    return tracked;
  }

  return {
    run(task, forceFull = false) {
      if (!inFlight) return start(task, forceFull);
      if (!forceFull || inFlightIsFull) return inFlight;
      if (queuedFull) return queuedFull;

      const active = inFlight;
      let queued: Promise<void>;
      queued = active
        .catch(() => {})
        .then(() => start(task, true))
        .finally(() => {
          if (queuedFull === queued) queuedFull = null;
        });
      queuedFull = queued;
      return queued;
    },
  };
}
