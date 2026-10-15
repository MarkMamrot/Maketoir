'use client';

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as Zeller from '@/lib/zeller';
import { createZellerReadiness, type ZellerReadiness } from '@/lib/pos/zellerReadiness';
import { reportPosDeviceIssue } from '@/lib/pos/posDeviceDiagnostics';
import { startPosSoundSession } from '@/lib/pos/posSounds';

const ReadinessContext = createContext<ZellerReadiness | null>(null);

function TerminalSession({ businessId, children }: { businessId: string; children: ReactNode }) {
  const terminal = Zeller.useTerminal();
  const terminalRef = useRef(terminal);
  terminalRef.current = terminal;
  const readiness = useMemo(() => createZellerReadiness(() => terminalRef.current.initialise(), check => {
    if (check.invalidated) return;
    if (check.error && 'type' in check.error && check.error.type === 'Setup Required') {
      console.warn('[POS] Zeller terminal needs pairing before payment.');
      return;
    }
    if (check.error) {
      reportPosDeviceIssue('pos_terminal_readiness', 'The Zeller readiness check did not confirm an available terminal.', businessId);
    } else if (check.checkMs >= 2_000) {
      reportPosDeviceIssue('pos_terminal_delay', 'Zeller readiness was slow before payment.', businessId, { readinessCheckMs: check.checkMs });
    }
  }), [businessId]);
  useEffect(() => {
    const invalidate = () => readiness.invalidate();
    window.addEventListener('online', invalidate);
    window.addEventListener('offline', invalidate);
    document.addEventListener('visibilitychange', invalidate);
    return () => {
      window.removeEventListener('online', invalidate);
      window.removeEventListener('offline', invalidate);
      document.removeEventListener('visibilitychange', invalidate);
      readiness.invalidate();
    };
  }, [readiness]);
  return <ReadinessContext.Provider value={readiness}>{children}</ReadinessContext.Provider>;
}

export function PosDeviceRuntime({ businessId, children }: { businessId: string; children: ReactNode }) {
  useEffect(() => startPosSoundSession(businessId), [businessId]);
  return (
    <Zeller.Provider vendorName="Marketoir" vendorApplicationName="Monsterthreads POS" vendorApplicationVersion="1.0.0" vendorDeviceType="POS">
      <TerminalSession businessId={businessId}>{children}</TerminalSession>
    </Zeller.Provider>
  );
}

export function useZellerReadiness(): ZellerReadiness {
  const readiness = useContext(ReadinessContext);
  if (!readiness) throw new Error('Terminal readiness must be used inside the POS device session.');
  return readiness;
}
