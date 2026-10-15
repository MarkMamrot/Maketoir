export interface ZellerReadinessCheck {
  error: Error | null;
  checkMs: number;
  cached: boolean;
  invalidated: boolean;
}

export function createZellerReadiness(
  initialise: () => Promise<unknown>,
  onCheck: (check: ZellerReadinessCheck) => void,
  now: () => number = Date.now,
) {
  let pending: Promise<ZellerReadinessCheck> | undefined;
  let ready: { checkedAt: number; checkMs: number } | undefined;
  let generation = 0;
  const freshnessMs = 30_000;

  function invalidate() { generation++; ready = undefined; }

  function prepare(force = false): Promise<ZellerReadinessCheck> {
    if (pending) return pending;
    if (!force && ready && now() - ready.checkedAt < freshnessMs) {
      return Promise.resolve({ error: null, checkMs: ready.checkMs, cached: true, invalidated: false });
    }
    ready = undefined;
    const started = now();
    const currentGeneration = generation;
    pending = Promise.resolve().then(initialise).then(result => {
      if (result instanceof Error) return result;
      return result === true ? null : new Error('Terminal readiness could not be confirmed.');
    }, error => error instanceof Error ? error : new Error('The terminal readiness request failed.'))
      .then(error => {
        const invalidated = currentGeneration !== generation;
        if (invalidated) {
          error = new Error('The terminal connection changed during its readiness check. Try again without charging.');
        }
        const check = { error, checkMs: Math.max(0, now() - started), cached: false, invalidated };
        if (!error) ready = { checkedAt: now(), checkMs: check.checkMs };
        onCheck(check);
        return check;
      }).finally(() => { pending = undefined; });
    return pending;
  }

  return {
    prepare,
    async consume() {
      const currentGeneration = generation;
      const check = await prepare();
      ready = undefined;
      return currentGeneration !== generation
        ? { ...check, invalidated: true, error: new Error('The POS terminal connection changed. Check readiness again without charging.') } : check;
    },
    invalidate,
    async waitForIdle() { await pending; },
  };
}

export type ZellerReadiness = ReturnType<typeof createZellerReadiness>;
