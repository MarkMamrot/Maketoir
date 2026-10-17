import type { ShopifyGiftCardRecoveryContinuation } from './shopifyGiftCardRecoveryEffects';
import type { ShopifyGiftCardHistoryCheckpoint } from './shopifyGiftCardRecoveryHistory';

function invalid(): never {
  throw new Error('Invalid Shopify gift-card recovery continuation.');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return value as Record<string, unknown>;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)
    || BigInt(value) > BigInt('9223372036854775807')) invalid();
  return value;
}

function token(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) invalid();
  return value;
}

function integer(value: unknown, nonnegative = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (nonnegative && value < 0)) invalid();
  return value;
}

function timestamp(value: unknown, provider: boolean): string {
  if (typeof value !== 'string') invalid();
  const expression = provider
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/
    : /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const match = expression.exec(value);
  if (!match) invalid();
  const [, y, m, d, h, minute, second] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  if (year < 1000 || month < 1 || month > 12 || day < 1
    || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || Number(h) > 23 || Number(minute) > 59 || Number(second) > 59
    || (provider && match[7] !== 'Z'
      && (Number(match[8]) > 14 || Number(match[9]) > 59 || (Number(match[8]) === 14 && Number(match[9]) !== 0)))) {
    invalid();
  }
  return value;
}

function transactionId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalid();
  const match = /^gid:\/\/shopify\/GiftCard(Credit|Debit|CashOut)Transaction\/([1-9]\d{0,18})$/.exec(value);
  if (!match) invalid();
  id(match[2]);
  return value;
}

function checkpoint(value: unknown): ShopifyGiftCardHistoryCheckpoint {
  const source = object(value);
  return {
    cardId: id(source.cardId),
    transactionCursor: token(source.transactionCursor),
    sourceVersion: timestamp(source.sourceVersion, true),
    latestTransactionId: transactionId(source.latestTransactionId),
    providerBalanceCents: integer(source.providerBalanceCents, true),
    runningBalanceCents: integer(source.runningBalanceCents),
    unseenAmountCents: integer(source.unseenAmountCents),
    baselineLocalBalanceCents: integer(source.baselineLocalBalanceCents, true),
    baselineObservedBalanceCents: source.baselineObservedBalanceCents === null
      ? null : integer(source.baselineObservedBalanceCents, true),
    baselineVersion: source.baselineVersion === null ? null : timestamp(source.baselineVersion, false),
  };
}

// An explicit projection, not a spread: raw provider/customer/private properties never survive.
export function parseShopifyGiftCardRecoveryContinuation(value: unknown): ShopifyGiftCardRecoveryContinuation {
  const source = object(value);
  if (source.status !== 'enabled' && source.status !== 'disabled') invalid();
  const pageInfo = source.pageInfo === null ? null : token(source.pageInfo);
  const nextPageInfo = source.nextPageInfo == null ? null : token(source.nextPageInfo);
  if (source.pageLoaded !== undefined && typeof source.pageLoaded !== 'boolean') invalid();
  const pageLoaded = source.pageLoaded ?? false;
  if (source.pendingCardIds !== undefined
    && (!Array.isArray(source.pendingCardIds) || source.pendingCardIds.length > 25)) invalid();
  const pendingCardIds = source.pendingCardIds === undefined ? [] : Array.from(source.pendingCardIds as unknown[], id);
  if (new Set(pendingCardIds).size !== pendingCardIds.length) invalid();
  const currentCard = source.currentCard == null ? null : checkpoint(source.currentCard);
  const reviewRequired = source.reviewRequired === undefined ? 0 : integer(source.reviewRequired, true);
  if ((pageLoaded && !pendingCardIds.length)
    || (!pageLoaded && (pendingCardIds.length || currentCard || nextPageInfo))
    || (currentCard && currentCard.cardId !== pendingCardIds[0])) invalid();
  return { status: source.status, pageInfo, pendingCardIds, nextPageInfo, pageLoaded, currentCard, reviewRequired };
}

export function serializeShopifyGiftCardRecoveryContinuation(value: ShopifyGiftCardRecoveryContinuation): string {
  return JSON.stringify(parseShopifyGiftCardRecoveryContinuation(value));
}
