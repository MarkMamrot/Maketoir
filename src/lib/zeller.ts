'use client';
/**
 * Zeller Payments SDK adapter — re-exports the real package.
 * Package: @zeller-public/payments-sdk-react
 */
export { Provider, useTerminal } from '@zeller-public/payments-sdk-react';
export type {
  TerminalClient  as ZellerTerminal,
  TerminalError   as ZellerError,
  TerminalTransaction as ZellerTransaction,
} from '@zeller-public/payments-sdk-react';

// ── Public types (match the real SDK shape) ────────────────────────────────

export type PurchaseSuccessResponse = {
  transactionUuid: string;
  status?: string;
  [key: string]: unknown;
};

export type ZellerTerminal = {
  /** One-time pairing — opens Zeller UI to sign in and select a terminal. */
  setup:    ()                                           => Promise<PurchaseSuccessResponse | Error>;
  /** Amount in cents, e.g. 1000 = $10.00 */
  purchase: (params: { amount: number; reference: string }) => Promise<PurchaseSuccessResponse | Error>;
  refund:   (params: { purchase: string; reference: string }) => Promise<PurchaseSuccessResponse | Error>;
};

// ── Stub implementation ────────────────────────────────────────────────────

const NOT_INSTALLED = (): Promise<Error> =>
  Promise.resolve(
    Object.assign(new Error('Zeller SDK not installed — ask your administrator to run: npm install @zeller-public/payments-sdk-react'), { type: 'not_installed' }),
  );

const STUB_TERMINAL: ZellerTerminal = {
  setup:    NOT_INSTALLED,
  purchase: NOT_INSTALLED,
  refund:   NOT_INSTALLED,
};

const TerminalCtx = React.createContext<ZellerTerminal>(STUB_TERMINAL);

export type ProviderProps = {
  vendorName:               string;
  vendorApplicationName:    string;
  vendorApplicationVersion: string;
  vendorDeviceType:         string;
  children:                 React.ReactNode;
};

export function Provider({ children }: ProviderProps) {
  // Once the real SDK is installed, this Provider handles WebView lifecycle,
  // message passing, and terminal state internally.
  return React.createElement(TerminalCtx.Provider, { value: STUB_TERMINAL }, children);
}

export function useTerminal(): ZellerTerminal {
  return React.useContext(TerminalCtx);
}
