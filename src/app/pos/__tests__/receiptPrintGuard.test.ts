import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReceiptPrintGate } from '../_receiptPrintGuard';

describe('createReceiptPrintGate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows only one print request to be active at a time', () => {
    vi.useFakeTimers();
    const gate = createReceiptPrintGate(1000);
    const calls: string[] = [];

    expect(gate.request(() => calls.push('first'))).toBe(true);
    expect(gate.request(() => calls.push('second'))).toBe(false);
    expect(calls).toEqual(['first']);

    gate.complete();

    expect(gate.request(() => calls.push('during cooldown'))).toBe(false);
    vi.advanceTimersByTime(999);
    expect(gate.request(() => calls.push('still cooling down'))).toBe(false);

    vi.advanceTimersByTime(1);
    expect(gate.request(() => calls.push('after cooldown'))).toBe(true);
    expect(calls).toEqual(['first', 'after cooldown']);
  });
});
