export interface GiftCardVoidConnection {
  execute<T = any>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

interface GiftCardTransactionRow {
  id: number;
  card_id: number;
  type: 'issue' | 'redeem' | 'return' | 'adjust';
  amount: string | number;
  created_at: string;
}

interface GiftCardRow {
  id: number;
  balance: string | number;
  shopify_gc_id: string | number | null;
}

export interface GiftCardVoidReversal {
  transactionId: number;
  cardId: number;
  kind: 'redemption';
  amount: number;
}

export class GiftCardVoidBlockedError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'GiftCardVoidBlockedError';
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function reversalKey(transactionId: number): string {
  return `void:gift-card-tx:${transactionId}`;
}

export async function unwindGiftCardTransactionsForSale(
  connection: GiftCardVoidConnection,
  saleId: number,
): Promise<GiftCardVoidReversal[]> {
  const [transactionRows] = await connection.execute<GiftCardTransactionRow[]>(
    `SELECT id, card_id, type, amount, created_at
       FROM gift_card_transactions
      WHERE pos_sale_id = ?
      ORDER BY id
      FOR UPDATE`,
    [saleId],
  );
  if (transactionRows.length === 0) return [];

  const cardIds = Array.from(new Set(transactionRows.map(row => Number(row.card_id))));
  const [cardRows] = await connection.execute<GiftCardRow[]>(
    `SELECT id, balance, shopify_gc_id
       FROM gift_cards
      WHERE id IN (${cardIds.map(() => '?').join(',')})
      ORDER BY id
      FOR UPDATE`,
    cardIds,
  );
  const cardsById = new Map(cardRows.map(row => [Number(row.id), row]));
  if (cardsById.size !== cardIds.length) {
    throw new GiftCardVoidBlockedError('A gift card linked to this sale no longer exists. The sale was not voided.');
  }

  for (const card of cardRows) {
    if (card.shopify_gc_id != null) {
      throw new GiftCardVoidBlockedError(
        'This sale used a Shopify-linked gift card. Automatic void is blocked until Shopify replacement-card history can be reversed safely.',
      );
    }
  }

  const reversals: GiftCardVoidReversal[] = [];
  const orderedTransactions = [
    ...transactionRows.filter(transaction => transaction.type === 'redeem'),
    ...transactionRows.filter(transaction => transaction.type !== 'redeem'),
  ];
  for (const transaction of orderedTransactions) {
    const transactionId = Number(transaction.id);
    const cardId = Number(transaction.card_id);
    const card = cardsById.get(cardId)!;
    const key = reversalKey(transactionId);
    const [existingRows] = await connection.execute<Array<{ id: number }>>(
      `SELECT id FROM gift_card_transactions WHERE idempotency_key = ? LIMIT 1`,
      [key],
    );
    if (existingRows.length > 0) continue;

    if (transaction.type === 'redeem') {
      const amount = Math.abs(roundCurrency(Number(transaction.amount)));
      if (!(amount > 0)) continue;
      const newBalance = roundCurrency(Number(card.balance) + amount);
      await connection.execute(
        `INSERT INTO gift_card_transactions
           (card_id, type, amount, balance_after, pos_sale_id, idempotency_key, notes)
         VALUES (?, 'return', ?, ?, ?, ?, ?)`,
        [cardId, amount, newBalance, saleId, key, `Voided POS sale ${saleId}; reverses gift card transaction ${transactionId}`],
      );
      await connection.execute(
        `UPDATE gift_cards SET balance = ?, status = 'active', last_used_at = NOW() WHERE id = ?`,
        [newBalance, cardId],
      );
      card.balance = newBalance;
      reversals.push({ transactionId, cardId, kind: 'redemption', amount });
      continue;
    }

    if (transaction.type === 'issue') {
      const [laterRows] = await connection.execute<Array<{ id: number; type: string; idempotency_key: string | null }>>(
        `SELECT id, type, idempotency_key
           FROM gift_card_transactions
          WHERE card_id = ? AND id > ?
          ORDER BY id
          FOR UPDATE`,
        [cardId, transactionId],
      );
      const reversedIds = new Set(
        laterRows
          .map(row => String(row.idempotency_key ?? '').match(/^void:gift-card-tx:(\d+)$/)?.[1])
          .filter(Boolean)
          .map(Number),
      );
      const unresolvedUse = laterRows.some(row => row.type === 'redeem' && !reversedIds.has(Number(row.id)));
      if (unresolvedUse) {
        throw new GiftCardVoidBlockedError(
          'This gift card has later redemptions. Void those redemption sales before voiding the issuing sale.',
        );
      }

      const currentBalance = roundCurrency(Number(card.balance));
      if (currentBalance !== 0) {
        await connection.execute(
          `INSERT INTO gift_card_transactions
             (card_id, type, amount, balance_after, pos_sale_id, idempotency_key, notes)
           VALUES (?, 'adjust', ?, 0, ?, ?, ?)`,
          [cardId, -currentBalance, saleId, key, `Voided issuing POS sale ${saleId}; cancels gift card transaction ${transactionId}`],
        );
      }
      await connection.execute(
        `UPDATE gift_cards SET balance = 0, status = 'cancelled', last_used_at = NOW() WHERE id = ?`,
        [cardId],
      );
      card.balance = 0;
    }
  }

  return reversals;
}