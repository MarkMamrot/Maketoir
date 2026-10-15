import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canCompleteSaleLocally, recordLocalSale } from '../_localSale';
import { loadDeviceConfig, loadOfflineQueue, newLocalId, saveDeviceConfig } from '../_store';
import type { CompletedSale, PaymentEntry } from '../_types';
import { getApprovedZellerPurchase } from '@/lib/pos/zellerPurchaseResult';

const page = ts.createSourceFile('page.tsx', readFileSync(resolve('src', 'app', 'pos', 'page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function functionSource(name: string, preserveJsx = false): string {
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(page);
  if (!found) throw new Error(`Checkout function ${name} was not found.`);
  if (preserveJsx) return found.getText(page);
  return ts.transpileModule(found.getText(page), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
}
const completionSource = functionSource('completeSale');
const receiptSource = functionSource('showCompletedReceipt');
const terminalSource = functionSource('handleZellerTransaction');

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() { return values.size; },
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    key: (index: number) => [...values.keys()][index] ?? null,
  });
  saveDeviceConfig({ business_id: 'checkout-test', location_id: 1, location_name: 'Store', register_id: 2, register_name: 'Till' });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('actual POS completion flow', () => {
  it.each([
    { isReady: true, eventFailure: false, status: 'APPROVED', isRefund: false },
    { isReady: false, eventFailure: false, status: 'APPROVED', isRefund: false },
    { isReady: true, eventFailure: true, status: 'APPROVED', isRefund: false },
    { isReady: true, eventFailure: false, status: 'APPROVED', isRefund: true },
    { isReady: true, eventFailure: false, status: 'DECLINED', isRefund: false },
    { isReady: true, eventFailure: false, status: 'UNKNOWN', isRefund: false },
    { isReady: true, eventFailure: false, status: 'ERROR', isRefund: false },
  ])('preserves single-submit and approved-result handling: %j', async ({ isReady, eventFailure, status, isRefund }) => {
    const result = status === 'ERROR'
      ? Object.assign(new Error('Terminal unavailable'), { type: 'Paired Device Not Available' })
      : { status, transactionUuid: 'approved-device-test' };
    const transaction = Object.assign(Promise.resolve(result), { onEvent: vi.fn(() => { if (eventFailure) throw new Error('Event registration unavailable'); }) });
    const execute = vi.fn(() => transaction);
    const finishPayment = vi.fn();
    const metrics = { pageWasHidden: false };
    const timing = { readiness: vi.fn(), sent: vi.fn(), terminalEvent: vi.fn(), finish: vi.fn(() => metrics) };
    const readiness = { consume: vi.fn().mockResolvedValue({
      error: isReady ? null : new Error('Paired Device Not Available'), checkMs: 10, cached: true,
    }), invalidate: vi.fn() };
    const context = {
      completionInFlight: { current: false }, terminalInFlight: { current: false },
      terminalOutcomeUnknown: false, capturedPaymentIds: { current: new Set() }, approvedSaleIdRef: { current: undefined },
      isLayby: false, isRefund, isCashMethod: false, remaining: 11, amount: '11', activeMethod: 'Card', payments: [],
      setZellerPending: vi.fn(), setZellerError: vi.fn(), setTerminalStage: vi.fn(),
      setPayments: vi.fn(), setAmount: vi.fn(), setTerminalOutcomeUnknown: vi.fn(),
      terminal: { initialise: vi.fn() }, readiness, diagnosticBusinessId: 'checkout-test',
      startTerminalTiming: () => timing, executeZellerTransaction: execute, getApprovedZellerPurchase,
      finishPayment, newLocalId, reportTerminalFailure: vi.fn(), reportPosDeviceIssue: vi.fn(),
      isSlowTerminalStart: () => false, console: { info: vi.fn() }, Error, Date, Math,
    };
    const pay: () => Promise<void> = runInNewContext(`${terminalSource};handleZellerTransaction;`, context);
    const attempt = pay();
    await pay();
    await attempt;
    expect(context.terminal.initialise).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(isReady ? 1 : 0);
    const approved = isReady && status === 'APPROVED';
    expect(finishPayment).toHaveBeenCalledTimes(approved ? 1 : 0);
    if (approved) {
      expect(execute).toHaveBeenCalledWith(context.terminal, expect.objectContaining({ amount: 1_100, isRefund }));
      expect(finishPayment).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ amount: isRefund ? -11 : 11, reference: 'approved-device-test' }),
      ]), 0, undefined, 'zeller:approved-device-test');
    }
    if (isReady && (status === 'UNKNOWN' || status === 'ERROR')) expect(context.setTerminalOutcomeUnknown).toHaveBeenCalledWith(true);
    if (eventFailure) expect(context.reportPosDeviceIssue).toHaveBeenCalled();
    expect(context.terminalInFlight.current).toBe(false);
    expect(readiness.invalidate).toHaveBeenCalledOnce();
  });
  it('opens layby receipts without awaiting catalogue refresh or deducting stock on a reprint', () => {
    const handleSync = vi.fn(() => new Promise(() => {}));
    const setCompletedSale = vi.fn();
    const setLastSale = vi.fn();
    const setScreen = vi.fn();
    const open: (sale: CompletedSale) => void = runInNewContext(`${receiptSource};showCompletedReceipt;`, {
      handleSync, setCompletedSale, setLastSale, setScreen, deviceConfig: loadDeviceConfig(),
    });
    const sale: CompletedSale = {
      id: 1, local_id: 'collected-layby', sale_type: 'layby', status: 'layby_complete',
      location_name: 'Store', cashier_name: 'Cashier', created_at: new Date().toISOString(),
      items: [], payments: [], subtotal: 11, discount_total: 0, tax_total: 1, total: 11,
    };
    open(sale);
    expect(setCompletedSale).toHaveBeenCalledWith(sale);
    expect(setScreen).toHaveBeenCalledWith('receipt');
    expect(handleSync).toHaveBeenCalledWith(false, loadDeviceConfig());
    expect(setLastSale).toHaveBeenCalledWith(sale);
  });
  it('keeps the full checkout page syntactically valid, including its receipt controls', () => {
    const diagnostics = ts.transpileModule(page.text, {
      reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).diagnostics ?? [];
    expect(diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
  });
  it('wires both receipt and checkout beneath one persistent device runtime in the actual page', () => {
    const rootSource = functionSource('PosPage', true);
    const runtime = rootSource.indexOf('PosDeviceRuntime');
    const receipt = rootSource.indexOf('ReceiptScreen');
    const checkout = rootSource.indexOf('mainPosContent', receipt);
    expect(runtime).toBeGreaterThan(-1);
    expect(receipt).toBeGreaterThan(runtime);
    expect(checkout).toBeGreaterThan(receipt);
    expect(rootSource).toContain('<MainPos');
    expect(rootSource.match(/PosDeviceRuntime/g)).toHaveLength(2);
  });
  it.each([true, false])('opens the receipt after persistence without awaiting a server, online=%s', async online => {
    const onReceipt = vi.fn((sale: CompletedSale) => {
      expect(loadOfflineQueue()[0].receipt?.local_id).toBe(sale.local_id);
    });
    const fetch = vi.fn(() => new Promise(() => {}));
    const clearCart = vi.fn();
    const context = {
      submittingRef: { current: false }, loyaltySaleLocalIdRef: { current: null },
      trainingMode: false, isLayby: false, linkedReturnSaleId: null, selectedReward: null,
      cart: [{ localId: 'item', variant_id: null, name: 'Product', qty: 1, unit_price: 11,
        original_price: null, discount_type: 'none', discount_value: 0, discount_amount: 0,
        tax_rate: 10, line_total: 11 }],
      products: [], totals: { subtotal: 11, discount_total: 0, tax_total: 1, total: 11,
        order_disc_amount: 0, loyalty_discount_amount: 0 },
      session: { register_id: 2, location_id: 1, pos_user_id: 3, location_name: 'Store', full_name: 'Cashier' },
      regSession: { id: 4 }, collectLayby: true, linkedContact: null,
      customerName: '', customerPhone: '', saleNotes: '',
      navigator: { onLine: online }, fetch, loadDeviceConfig, newLocalId,
      canCompleteSaleLocally, recordLocalSale, Date, Map, Set,
      setSaleSubmitError: vi.fn(), onSaleCompleted: vi.fn(), setShowPayment: vi.fn(),
      onChangeDue: vi.fn(), onReceipt, clearCart,
    };
    const complete: (payments: PaymentEntry[], changeDue: number, rounding: number, localId: string) => Promise<void>
      = runInNewContext(`${completionSource};completeSale;`, context);
    await complete([{ localId: 'payment', method: 'Card', amount: 11, reference: 'approved-transaction' }], 0, 0, 'zeller:approved-transaction');
    expect(fetch).not.toHaveBeenCalled();
    expect(onReceipt).toHaveBeenCalledOnce();
    expect(onReceipt.mock.calls[0][0]).toMatchObject({ local_id: 'zeller:approved-transaction', sync_status: 'pending', tax_total: 1 });
    expect(loadOfflineQueue()[0].payload).toMatchObject({ register_session_id: 4, completed_at: expect.any(String) });
    expect(clearCart).toHaveBeenCalledOnce();
    expect(context.submittingRef.current).toBe(false);
  });
});
