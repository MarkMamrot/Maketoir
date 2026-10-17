import { describe, expect, it } from 'vitest';
import {
  parseShopifyGiftCardRecoveryContinuation as parse,
  serializeShopifyGiftCardRecoveryContinuation as serialize,
} from '../shopifyGiftCardRecoveryCheckpoint';

const currentCard = {
  cardId: '12345',
  transactionCursor: 'eyJsYXN0X2lkIjoxMjN9',
  sourceVersion: '2026-10-17T10:00:00.123Z',
  latestTransactionId: 'gid://shopify/GiftCardDebitTransaction/98765',
  providerBalanceCents: 7000,
  runningBalanceCents: 9000,
  unseenAmountCents: -2000,
  baselineLocalBalanceCents: 10000,
  baselineObservedBalanceCents: 10000,
  baselineVersion: '2026-10-16 10:00:00',
};
const continuation = {
  status: 'enabled' as const,
  pageInfo: 'eyJsYXN0X2lkIjoxfQ==',
  pendingCardIds: ['12345', '12346'],
  nextPageInfo: 'eyJsYXN0X2lkIjoyfQ==',
  pageLoaded: true,
  currentCard,
  reviewRequired: 2,
};

describe('gift-card recovery continuation whitelist', () => {
  it('projects only explicitly allowed root and nested checkpoint fields', () => {
    const parsed = parse({
      ...continuation, token: 'private', customer: { email: 'private' }, providerPayload: { orders: [] },
      currentCard: { ...currentCard, token: 'private', snapshot: { balance: 70 }, customer_id: 'private' },
    });
    expect(parsed).toEqual(continuation);
    expect(JSON.stringify(parsed)).not.toMatch(/private|snapshot|providerPayload|customer|token/);
  });

  it('canonicalizes discovery defaults and preserves zero/null checkpoint values', () => {
    expect(parse({ status: 'disabled', pageInfo: null })).toEqual({
      status: 'disabled', pageInfo: null, pendingCardIds: [], nextPageInfo: null,
      pageLoaded: false, currentCard: null, reviewRequired: 0,
    });
    expect(parse({
      ...continuation, currentCard: {
        ...currentCard, latestTransactionId: null, baselineObservedBalanceCents: null,
        baselineVersion: null, providerBalanceCents: 0, runningBalanceCents: 0, unseenAmountCents: 0,
      },
    }).currentCard).toMatchObject({
      latestTransactionId: null, baselineObservedBalanceCents: null, baselineVersion: null,
      providerBalanceCents: 0, runningBalanceCents: 0, unseenAmountCents: 0,
    });
  });

  it('round trips a sanitized detached continuation without runtime imports', () => {
    const input = { ...continuation, privateField: 'must not persist' };
    const serialized = serialize(input);
    expect(serialized).not.toContain('must not persist');
    const parsed = parse(JSON.parse(serialized));
    expect(parsed).toEqual(continuation);
    parsed.pendingCardIds!.push('12347');
    expect(input.pendingCardIds).toEqual(['12345', '12346']);
    expect(parsed.currentCard).not.toBe(input.currentCard);
  });

  it.each([null, undefined, [], 'json', new Date(), Object.create({ status: 'enabled', pageInfo: null })])(
    'rejects non-record or initial null values without reflecting their contents: %j', value => {
      expect(() => parse(value)).toThrow('Invalid Shopify gift-card recovery continuation.');
    },
  );

  it.each(['0', '-1', '01', '1.2', '1e3', ' 12345', '9223372036854775808', 'gid://shopify/GiftCard/12345'])(
    'rejects invalid or out-of-range numeric card ID %s', value => {
      expect(() => parse({ ...continuation, pendingCardIds: [value], currentCard: null })).toThrow('Invalid');
    },
  );

  it('bounds and deduplicates the entire pending ID queue', () => {
    expect(() => parse({
      ...continuation, pendingCardIds: Array.from({ length: 26 }, (_, index) => String(index + 1)), currentCard: null,
    })).toThrow('Invalid');
    expect(() => parse({ ...continuation, pendingCardIds: ['12345', '12345'] })).toThrow('Invalid');
    expect(parse({
      ...continuation, pendingCardIds: Array.from({ length: 25 }, (_, index) => String(index + 1)), currentCard: null,
    }).pendingCardIds).toHaveLength(25);
  });

  it.each(['', 'https://private.example/?token=secret', 'Bearer secret', 'abc\n', 'x'.repeat(4097), 'abc==='])(
    'rejects malformed cursors without echoing them: %j', pageInfo => {
      expect(() => parse({ ...continuation, pageInfo })).toThrow(/^Invalid Shopify gift-card recovery continuation\.$/);
      expect(() => parse({ ...continuation, currentCard: { ...currentCard, transactionCursor: pageInfo } })).toThrow('Invalid');
    },
  );

  it.each([
    '2026-02-30T10:00:00Z', '2025-02-29T10:00:00Z', '2026-10-17 10:00:00',
    '2026-10-17T25:00:00Z', '2026-10-17T10:00:00+14:01', 'secret',
  ])('rejects invalid provider versions %s', sourceVersion => {
    expect(() => parse({ ...continuation, currentCard: { ...currentCard, sourceVersion } })).toThrow('Invalid');
  });

  it('accepts real leap days/timezone offsets and validates SQL baseline timestamps separately', () => {
    expect(parse({
      ...continuation, currentCard: { ...currentCard, sourceVersion: '2024-02-29T23:59:59+11:00' },
    }).currentCard?.sourceVersion).toBe('2024-02-29T23:59:59+11:00');
    for (const baselineVersion of ['2026-02-30 00:00:00', '2026-10-17T10:00:00Z', 'secret']) {
      expect(() => parse({ ...continuation, currentCard: { ...currentCard, baselineVersion } })).toThrow('Invalid');
    }
  });

  it.each([NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '100', null])(
    'rejects unsafe or nonnumeric cents/counters %j', value => {
      for (const key of [
        'providerBalanceCents', 'runningBalanceCents', 'unseenAmountCents', 'baselineLocalBalanceCents',
      ]) {
        expect(() => parse({ ...continuation, currentCard: { ...currentCard, [key]: value } })).toThrow('Invalid');
      }
      expect(() => parse({ ...continuation, reviewRequired: value })).toThrow('Invalid');
    },
  );

  it('rejects missing required nested fields and false checkpoint identities', () => {
    for (const key of Object.keys(currentCard)) {
      const incomplete: Record<string, unknown> = { ...currentCard };
      delete incomplete[key];
      expect(() => parse({ ...continuation, currentCard: incomplete })).toThrow('Invalid');
    }
    expect(() => parse({ ...continuation, currentCard: { ...currentCard, cardId: '999' } })).toThrow('Invalid');
    for (const latestTransactionId of ['98765', 'gid://shopify/Customer/98765', 'gid://shopify/GiftCardDebitTransaction/0']) {
      expect(() => parse({ ...continuation, currentCard: { ...currentCard, latestTransactionId } })).toThrow('Invalid');
    }
  });

  it('rejects inconsistent discovery/history phases', () => {
    expect(() => parse({ ...continuation, pageLoaded: false })).toThrow('Invalid');
    expect(() => parse({ ...continuation, pendingCardIds: [] })).toThrow('Invalid');
    expect(() => parse({ status: 'enabled', pageInfo: null, nextPageInfo: 'next' })).toThrow('Invalid');
    expect(() => parse({ ...continuation, pageLoaded: 'true' })).toThrow('Invalid');
    expect(() => parse({ ...continuation, status: 'expired' })).toThrow('Invalid');
    expect(() => parse({ ...continuation, reviewRequired: -1 })).toThrow('Invalid');
  });
});
