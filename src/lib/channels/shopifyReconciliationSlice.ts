import {
  ONLINE_SYNC_LIMITS, OnlineSyncValidationError, parseReconciliationContinuation,
  type OrderReference, type ReconciliationContinuation, type ReconciliationWindow,
} from './onlineSyncPolicy';

export interface ShopifyReconciliationSliceDependencies {
  now(): number;
  renew(): Promise<void>;
  save(continuation: ReconciliationContinuation): Promise<void>;
  page(window: ReconciliationWindow, pageInfo: string | null): Promise<{
    orders: OrderReference[];
    nextPageInfo: string | null;
  }>;
  apply(order: OrderReference, window: ReconciliationWindow): Promise<'applied' | 'already_current' | 'review'>;
  complete(window: ReconciliationWindow): Promise<void>;
}

export interface ShopifyReconciliationSliceResult {
  processed: number;
  review: number;
  fetchedPages: number;
  complete: boolean;
}

export async function runShopifyReconciliationSlice(
  input: { continuation: ReconciliationContinuation; deadline: number; remainingBudget: number },
  dependencies: ShopifyReconciliationSliceDependencies,
): Promise<ShopifyReconciliationSliceResult> {
  if (!Number.isFinite(input.deadline) || !Number.isSafeInteger(input.remainingBudget) || input.remainingBudget < 0) {
    throw new OnlineSyncValidationError('Invalid reconciliation work budget.');
  }
  let continuation = parseReconciliationContinuation(input.continuation);
  const result: ShopifyReconciliationSliceResult = { processed: 0, review: 0, fetchedPages: 0, complete: false };
  const budget = Math.min(ONLINE_SYNC_LIMITS.ordersPerChannel, input.remainingBudget);
  const canWork = () => dependencies.now() < input.deadline && result.processed < budget;
  if (!canWork()) return result;

  await dependencies.renew();
  if (!continuation.pageLoaded) {
    const page = await dependencies.page(continuation.window, continuation.pageInfo);
    continuation = parseReconciliationContinuation({
      ...continuation, pageLoaded: true, remaining: page.orders, nextPageInfo: page.nextPageInfo,
    });
    if (continuation.nextPageInfo !== null && continuation.nextPageInfo === continuation.pageInfo) {
      throw new OnlineSyncValidationError('Shopify returned a non-advancing pagination token.');
    }
    await dependencies.save(continuation);
    result.fetchedPages = 1;
  }

  while (continuation.remaining.length && canWork()) {
    await dependencies.renew();
    const outcome = await dependencies.apply(continuation.remaining[0], continuation.window);
    continuation = { ...continuation, remaining: continuation.remaining.slice(1) };
    await dependencies.save(continuation);
    result.processed += 1;
    if (outcome === 'review') result.review += 1;
  }
  if (continuation.remaining.length) return result;
  await dependencies.renew();
  if (continuation.nextPageInfo !== null) {
    await dependencies.save({
      ...continuation, pageInfo: continuation.nextPageInfo,
      pageLoaded: false, remaining: [], nextPageInfo: null,
    });
  } else {
    await dependencies.complete(continuation.window);
    result.complete = true;
  }
  return result;
}
