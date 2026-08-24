import { describe, expect, it } from 'vitest';
import { createReceiptPrintGate } from '../_receiptPrintGuard';

describe('createReceiptPrintGate', () => {
  it('allows only one print request for the lifetime of a receipt preview', () => {
    const gate = createReceiptPrintGate();
    const calls: string[] = [];

    expect(gate.request(() => calls.push('first'))).toBe(true);
    expect(gate.request(() => calls.push('second'))).toBe(false);
    expect(calls).toEqual(['first']);
    expect(gate.hasRequested()).toBe(true);

    gate.complete();

    expect(gate.isPending()).toBe(false);
    expect(gate.request(() => calls.push('after print'))).toBe(false);
    expect(gate.request(() => calls.push('another repeat'))).toBe(false);
    expect(calls).toEqual(['first']);
  });

  it('recovers when starting the print request throws', () => {
    const gate = createReceiptPrintGate();

    expect(() => gate.request(() => { throw new Error('print unavailable'); })).toThrow('print unavailable');
    expect(gate.hasRequested()).toBe(false);
    expect(gate.request(() => undefined)).toBe(true);
  });
});
