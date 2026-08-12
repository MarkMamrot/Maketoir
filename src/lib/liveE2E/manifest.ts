import { redactLiveE2EValue } from './safety';

export type LiveRunState =
  | 'initialized'
  | 'preflight_passed'
  | 'p1_created'
  | 'p2_created'
  | 'p3_created'
  | 'p4_created'
  | 'awaiting_operator'
  | 'acknowledged'
  | 'compensation_retry_authorized'
  | 'compensating'
  | 'verification_authorized'
  | 'clean'
  | 'blocked';

export type LiveRunEvent = {
  sequence: number;
  state: LiveRunState;
  at: string;
  details: unknown;
};

const TRANSITIONS: Record<LiveRunState, ReadonlySet<LiveRunState>> = {
  initialized: new Set(['preflight_passed', 'blocked']),
  preflight_passed: new Set(['p1_created', 'p2_created', 'p3_created', 'blocked']),
  p1_created: new Set(['p1_created', 'awaiting_operator', 'blocked']),
  p2_created: new Set(['p2_created', 'awaiting_operator', 'blocked']),
  p3_created: new Set(['p3_created', 'awaiting_operator', 'blocked']),
  p4_created: new Set(['p4_created', 'awaiting_operator', 'blocked']),
  awaiting_operator: new Set(['awaiting_operator', 'acknowledged', 'blocked']),
  acknowledged: new Set(['compensating', 'blocked']),
  compensation_retry_authorized: new Set(['compensating', 'blocked']),
  compensating: new Set(['clean', 'blocked']),
  verification_authorized: new Set(['verification_authorized', 'clean', 'blocked']),
  clean: new Set(),
  blocked: new Set(['compensation_retry_authorized', 'verification_authorized', 'p3_created', 'p4_created']),
};

export function appendLiveRunEvent(
  events: readonly LiveRunEvent[],
  nextState: LiveRunState,
  details: unknown,
  now = new Date(),
): LiveRunEvent[] {
  const currentState = events.at(-1)?.state ?? 'initialized';
  if (events.length > 0 && !TRANSITIONS[currentState].has(nextState)) {
    throw new Error(`Live E2E blocked: invalid manifest transition ${currentState} -> ${nextState}.`);
  }
  if (events.length === 0 && nextState !== 'initialized') {
    throw new Error('Live E2E blocked: the first manifest event must be initialized.');
  }

  return [...events, {
    sequence: events.length + 1,
    state: nextState,
    at: now.toISOString(),
    details: redactLiveE2EValue(details),
  }];
}

export function assertRunMayStart(events: readonly LiveRunEvent[]): void {
  const state = events.at(-1)?.state;
  if (state && state !== 'clean') {
    throw new Error(`Live E2E blocked: an earlier run remains ${state}.`);
  }
}