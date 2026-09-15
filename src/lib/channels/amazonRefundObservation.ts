import type { AmazonFinancialTransaction } from '@/lib/channels/amazonSpApi';

export interface AmazonRefundObservation {
  amazonOrderId: string;
  amazonRefundId: string;
  transactionId: string;
  postedAt: string;
  currencyCode: string;
  sellerNetAmount: number;
  items: Array<{ merchantSku: string | null; asin: string | null; quantity: number | null }>;
}

function relatedIdentifier(transaction: AmazonFinancialTransaction, name: string): string {
  return String(transaction.relatedIdentifiers?.find(identifier =>
    String(identifier.relatedIdentifierName ?? '').toUpperCase() === name)?.relatedIdentifierValue ?? '').trim();
}

export function normalizeAmazonRefundTransactions(transactions: AmazonFinancialTransaction[]): AmazonRefundObservation[] {
  const observations: AmazonRefundObservation[] = [];
  for (const transaction of transactions) {
    if (String(transaction.transactionStatus ?? '').toUpperCase() !== 'RELEASED') continue;
    const amazonOrderId = relatedIdentifier(transaction, 'ORDER_ID');
    const amazonRefundId = relatedIdentifier(transaction, 'REFUND_ID');
    const transactionId = String(transaction.transactionId ?? '').trim();
    const postedAt = String(transaction.postedDate ?? '').trim();
    if (!amazonOrderId || !amazonRefundId || !transactionId || !Number.isFinite(new Date(postedAt).getTime())) continue;
    observations.push({
      amazonOrderId,
      amazonRefundId,
      transactionId,
      postedAt: new Date(postedAt).toISOString(),
      currencyCode: String(transaction.totalAmount?.currencyCode ?? 'AUD').trim().toUpperCase() || 'AUD',
      sellerNetAmount: Math.round(Number(transaction.totalAmount?.currencyAmount ?? 0) * 100) / 100,
      items: (transaction.items ?? []).map(item => {
        const context = item.contexts?.[0];
        return {
          merchantSku: String(context?.sku ?? '').trim() || null,
          asin: String(context?.asin ?? '').trim() || null,
          quantity: Number.isFinite(Number(context?.quantityShipped)) ? Math.abs(Number(context?.quantityShipped)) : null,
        };
      }),
    });
  }
  return observations;
}

export function amazonRefundEventId(observation: AmazonRefundObservation): string {
  return `refund:${observation.amazonRefundId}:${observation.transactionId}`.slice(0, 191);
}