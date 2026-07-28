export type ShopifyPayoutTransactionKind =
  | 'charge'
  | 'refund'
  | 'adjustment';

export interface ShopifyPayoutTransactionInput {
  id: string;
  type: string;
  amount: number | string;
  fee: number | string;
  net: number | string;
  currency: string;
  invoiceId?: string | null;
  invoiceDate?: string | null;
  /** True when the invoice for this charge was already paid in Xero by an earlier (pre-payout-tracking) sync.
   * Such charges count toward grossCharges/transactionNet but do NOT create invoice_payment actions
   * and do NOT block reconciliation as unresolved. */
  preSettled?: boolean;
}

export interface ShopifyInvoiceAllocation {
  invoiceId: string;
  invoiceDate: string;
  amount: number;
  transactionIds: string[];
}

export interface ShopifyPayoutReconciliation {
  balanced: boolean;
  difference: number;
  transactionNet: number;
  grossCharges: number;
  refunds: number;
  fees: number;
  adjustments: number;
  invoiceAllocations: ShopifyInvoiceAllocation[];
  unresolvedChargeIds: string[];
}

const CHARGE_TYPES = new Set(['charge', 'payment']);
const REFUND_TYPES = new Set(['refund']);

function toCents(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid currency amount: ${value}`);
  return Math.round(parsed * 100);
}

function fromCents(value: number): number {
  return value / 100;
}

export function classifyShopifyPayoutTransaction(type: string): ShopifyPayoutTransactionKind {
  const normalized = type.trim().toLowerCase();
  if (CHARGE_TYPES.has(normalized)) return 'charge';
  if (REFUND_TYPES.has(normalized)) return 'refund';
  return 'adjustment';
}

export function reconcileShopifyPayout(input: {
  payoutAmount: number | string;
  payoutCurrency: string;
  transactions: ShopifyPayoutTransactionInput[];
}): ShopifyPayoutReconciliation {
  const payoutCurrency = input.payoutCurrency.trim().toUpperCase();
  const payoutCents = toCents(input.payoutAmount);
  const allocations = new Map<string, {
    invoiceId: string;
    invoiceDate: string;
    amountCents: number;
    transactionIds: string[];
  }>();
  const unresolvedChargeIds: string[] = [];

  let transactionNetCents = 0;
  let grossChargeCents = 0;
  let refundCents = 0;
  let feeCents = 0;
  let adjustmentCents = 0;

  for (const transaction of input.transactions) {
    const currency = transaction.currency.trim().toUpperCase();
    if (currency !== payoutCurrency) {
      throw new Error(`Payout currency ${payoutCurrency} does not match transaction ${transaction.id} currency ${currency}`);
    }

    const amountCents = toCents(transaction.amount);
    const transactionFeeCents = toCents(transaction.fee);
    const netCents = toCents(transaction.net);
    const kind = classifyShopifyPayoutTransaction(transaction.type);

    transactionNetCents += netCents;
    feeCents += Math.abs(transactionFeeCents);

    if (kind === 'charge') {
      grossChargeCents += amountCents;
      if (transaction.preSettled) {
        // Invoice already paid in Xero by the old sync flow — count toward net but skip allocation.
        continue;
      }
      if (!transaction.invoiceId || !transaction.invoiceDate) {
        unresolvedChargeIds.push(transaction.id);
        continue;
      }

      const existing = allocations.get(transaction.invoiceId) ?? {
        invoiceId: transaction.invoiceId,
        invoiceDate: transaction.invoiceDate,
        amountCents: 0,
        transactionIds: [],
      };
      if (existing.invoiceDate !== transaction.invoiceDate) {
        throw new Error(`Invoice ${transaction.invoiceId} has conflicting sales dates`);
      }
      existing.amountCents += amountCents;
      existing.transactionIds.push(transaction.id);
      allocations.set(transaction.invoiceId, existing);
    } else if (kind === 'refund') {
      refundCents += Math.abs(amountCents);
    } else {
      adjustmentCents += amountCents;
    }
  }

  const differenceCents = transactionNetCents - payoutCents;

  return {
    balanced: differenceCents === 0 && unresolvedChargeIds.length === 0,
    difference: fromCents(differenceCents),
    transactionNet: fromCents(transactionNetCents),
    grossCharges: fromCents(grossChargeCents),
    refunds: fromCents(refundCents),
    fees: fromCents(feeCents),
    adjustments: fromCents(adjustmentCents),
    invoiceAllocations: Array.from(allocations.values())
      .sort((left, right) => left.invoiceDate.localeCompare(right.invoiceDate))
      .map(allocation => ({
        invoiceId: allocation.invoiceId,
        invoiceDate: allocation.invoiceDate,
        amount: fromCents(allocation.amountCents),
        transactionIds: allocation.transactionIds,
      })),
    unresolvedChargeIds,
  };
}