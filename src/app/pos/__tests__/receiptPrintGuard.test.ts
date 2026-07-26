import { describe, expect, it } from 'vitest';
import { createReceiptPrintGate } from '../_receiptPrintGuard';

describe('createReceiptPrintGate', () => {
  it('allows only one print request to be active at a time', () => {
    const gate = createReceiptPrintGate();
    const calls: string[] = [];

    expect(gate.request(() => calls.push('first'))).toBe(true);
    expect(gate.request(() => calls.push('second'))).toBe(false);
    expect(calls).toEqual(['first']);

    gate.complete();

    expect(gate.request(() => calls.push('third'))).toBe(true);
    expect(calls).toEqual(['first', 'third']);
  });
});
