// @vitest-environment jsdom
import { StrictMode, useEffect, type ReactNode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PosDeviceRuntime, useZellerReadiness } from '../PosDeviceRuntime';
import type { ZellerReadiness } from '@/lib/pos/zellerReadiness';

const mocks = vi.hoisted(() => ({ initialise: vi.fn(), loaded: vi.fn(), unloaded: vi.fn() }));
vi.mock('@/lib/zeller', () => ({
  Provider: ({ children }: { children: ReactNode }) => {
    useEffect(() => { mocks.loaded(); return () => { mocks.unloaded(); }; }, []);
    return <>{children}<iframe title="test Zeller session" /></>;
  },
  useTerminal: () => ({ initialise: mocks.initialise }),
}));
const managers: ZellerReadiness[] = [];
function Checkout() {
  const readiness = useZellerReadiness();
  useEffect(() => { managers.push(readiness); void readiness.prepare(); }, [readiness]);
  return <div>Checkout</div>;
}
beforeEach(() => { vi.clearAllMocks(); mocks.initialise.mockResolvedValue(true); managers.length = 0; });
afterEach(cleanup);

describe('POS device session lifecycle', () => {
  it('remains usable after StrictMode effect replay and invalidates readiness on reconnect', async () => {
    render(<StrictMode><PosDeviceRuntime businessId="business"><Checkout /></PosDeviceRuntime></StrictMode>);
    await waitFor(() => expect(managers.length).toBeGreaterThan(0));
    const readiness = managers[managers.length - 1];
    await act(async () => { await readiness.prepare(); });
    await expect(readiness.consume()).resolves.toMatchObject({ error: null });
    await readiness.prepare();
    const checks = mocks.initialise.mock.calls.length;
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    await expect(readiness.consume()).resolves.toMatchObject({ error: null, cached: false });
    expect(mocks.initialise).toHaveBeenCalledTimes(checks + 1);
  });

  it('preserves the actual readiness manager and SDK mount across checkout, receipt, and next checkout', async () => {
    const view = render(<PosDeviceRuntime key="business:branch:till" businessId="business"><Checkout /></PosDeviceRuntime>);
    await waitFor(() => expect(mocks.initialise).toHaveBeenCalledOnce());
    view.rerender(<PosDeviceRuntime key="business:branch:till" businessId="business"><div>Receipt</div></PosDeviceRuntime>);
    expect(mocks.unloaded).not.toHaveBeenCalled();
    view.rerender(<PosDeviceRuntime key="business:branch:till" businessId="business"><Checkout /></PosDeviceRuntime>);
    await waitFor(() => expect(managers).toHaveLength(2));
    expect(managers[1]).toBe(managers[0]);
    expect(mocks.loaded).toHaveBeenCalledOnce();
    expect(mocks.initialise).toHaveBeenCalledOnce();
  });

  it('creates a fresh session when the register or business boundary changes', async () => {
    const view = render(<PosDeviceRuntime key="one:branch:till1" businessId="one"><Checkout /></PosDeviceRuntime>);
    await waitFor(() => expect(mocks.initialise).toHaveBeenCalledOnce());
    view.rerender(<PosDeviceRuntime key="one:branch:till2" businessId="one"><Checkout /></PosDeviceRuntime>);
    await waitFor(() => expect(mocks.initialise).toHaveBeenCalledTimes(2));
    expect(managers[1]).not.toBe(managers[0]);
    view.rerender(<PosDeviceRuntime key="two:branch:till2" businessId="two"><Checkout /></PosDeviceRuntime>);
    await waitFor(() => expect(mocks.initialise).toHaveBeenCalledTimes(3));
    expect(managers[2]).not.toBe(managers[1]);
    expect(mocks.unloaded).toHaveBeenCalledTimes(2);
  });
});
