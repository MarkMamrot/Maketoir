import { describe, expect, it } from 'vitest';

import { appendLiveRunEvent, assertRunMayStart } from '../manifest';

describe('live E2E manifest', () => {
  it('enforces the operator gate before compensation', () => {
    const initialized = appendLiveRunEvent([], 'initialized', { runId: 'run-1' });
    const preflight = appendLiveRunEvent(initialized, 'preflight_passed', {});
    const created = appendLiveRunEvent(preflight, 'p1_created', { purchaseOrderId: 41 });
    const waiting = appendLiveRunEvent(created, 'awaiting_operator', { xeroDocumentId: 'safe-id' });

    expect(() => appendLiveRunEvent(waiting, 'compensating', {})).toThrow('invalid manifest transition');
    const acknowledged = appendLiveRunEvent(waiting, 'acknowledged', { operator: 'human' });
    expect(appendLiveRunEvent(acknowledged, 'compensating', {}).at(-1)?.state).toBe('compensating');
  });

  it('keeps clean runs terminal and requires explicit authorization after a blocked compensation', () => {
    const initialized = appendLiveRunEvent([], 'initialized', {});
    const blocked = appendLiveRunEvent(initialized, 'blocked', { reason: 'Xero mismatch' });
    expect(() => appendLiveRunEvent(blocked, 'preflight_passed', {})).toThrow('invalid manifest transition');
    const retryAuthorized = appendLiveRunEvent(blocked, 'compensation_retry_authorized', { operator: 'Mark' });
    expect(appendLiveRunEvent(retryAuthorized, 'compensating', {}).at(-1)?.state).toBe('compensating');

    const preflight = appendLiveRunEvent(initialized, 'preflight_passed', {});
    const created = appendLiveRunEvent(preflight, 'p1_created', {});
    const waiting = appendLiveRunEvent(created, 'awaiting_operator', {});
    const acknowledged = appendLiveRunEvent(waiting, 'acknowledged', {});
    const compensating = appendLiveRunEvent(acknowledged, 'compensating', {});
    const clean = appendLiveRunEvent(compensating, 'clean', {});
    expect(() => appendLiveRunEvent(clean, 'initialized', {})).toThrow('invalid manifest transition');
  });

  it('keeps a created P1 artifact resumable after a receive attempt fails', () => {
    const initialized = appendLiveRunEvent([], 'initialized', {});
    const preflight = appendLiveRunEvent(initialized, 'preflight_passed', {});
    const created = appendLiveRunEvent(preflight, 'p1_created', { purchaseOrderId: 41 });
    const retryable = appendLiveRunEvent(created, 'p1_created', { purchaseOrderId: 41, receiveError: 'modal did not open' });

    expect(retryable.at(-1)).toMatchObject({ state: 'p1_created', details: { purchaseOrderId: 41 } });
    expect(() => appendLiveRunEvent(retryable, 'compensating', {})).toThrow('invalid manifest transition');
    expect(appendLiveRunEvent(retryable, 'awaiting_operator', {}).at(-1)?.state).toBe('awaiting_operator');
  });

  it('keeps a repaired external artifact behind renewed operator inspection', () => {
    const initialized = appendLiveRunEvent([], 'initialized', {});
    const preflight = appendLiveRunEvent(initialized, 'preflight_passed', {});
    const created = appendLiveRunEvent(preflight, 'p1_created', { purchaseOrderId: 41 });
    const waiting = appendLiveRunEvent(created, 'awaiting_operator', {});
    const repaired = appendLiveRunEvent(waiting, 'awaiting_operator', { xeroTotal: 1 });

    expect(repaired.at(-1)?.state).toBe('awaiting_operator');
    expect(() => appendLiveRunEvent(repaired, 'compensating', {})).toThrow('invalid manifest transition');
  });

  it('allows verification-only recovery after compensation committed but verification failed', () => {
    const initialized = appendLiveRunEvent([], 'initialized', {});
    const blocked = appendLiveRunEvent(initialized, 'blocked', { phase: 'compensation' });
    const authorized = appendLiveRunEvent(blocked, 'verification_authorized', { operator: 'Mark' });
    expect(appendLiveRunEvent(authorized, 'clean', {}).at(-1)?.state).toBe('clean');
  });

  it('redacts secrets in every appended event', () => {
    const events = appendLiveRunEvent([], 'initialized', { cookie: 'secret', poId: 41 });
    expect(events[0].details).toEqual({ cookie: '[REDACTED]', poId: 41 });
  });

  it('blocks another scenario while an earlier run is unresolved', () => {
    expect(() => assertRunMayStart(appendLiveRunEvent([], 'initialized', {}))).toThrow('remains initialized');
    expect(() => assertRunMayStart([])).not.toThrow();
  });
});