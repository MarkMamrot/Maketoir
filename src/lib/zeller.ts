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
