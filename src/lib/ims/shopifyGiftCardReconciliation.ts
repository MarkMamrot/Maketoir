export interface ShopifyGiftCardSnapshot {
  id: string | number;
  last_characters?: string | null;
  initial_value?: string | number | null;
  balance?: string | number | null;
  currency?: string | null;
  expires_on?: string | null;
  disabled_at?: string | null;
  customer_id?: string | number | null;
  order_id?: string | number | null;
  line_item_id?: string | number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ShopifyGiftCardImportPlan {
  shopifyGiftCardId: string;
  preferredCode: string;
  fallbackCode: string;
  initialBalance: number;
  balance: number;
  status: 'active' | 'redeemed' | 'cancelled';
  currency: string;
  expiresOn: string | null;
  customerId: string | null;
  orderId: string | null;
  lineItemId: string | null;
  createdAt: string | null;
}

function nullableString(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function money(value: unknown): number {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? Math.round(normalized * 100) / 100 : 0;
}

export function planShopifyGiftCardImport(card: ShopifyGiftCardSnapshot): ShopifyGiftCardImportPlan {
  const shopifyGiftCardId = nullableString(card.id);
  if (!shopifyGiftCardId) throw new Error('Shopify gift card ID is required.');

  const balance = money(card.balance);
  const lastCharacters = nullableString(card.last_characters);
  const initialValue = card.initial_value == null ? balance : money(card.initial_value);
  const fallbackCode = `SHOPIFY:ID:${shopifyGiftCardId}`;

  return {
    shopifyGiftCardId,
    preferredCode: lastCharacters ? `SHOPIFY:${lastCharacters}` : fallbackCode,
    fallbackCode,
    initialBalance: initialValue,
    balance,
    status: card.disabled_at ? (balance <= 0 ? 'redeemed' : 'cancelled') : 'active',
    currency: nullableString(card.currency) ?? 'AUD',
    expiresOn: nullableString(card.expires_on),
    customerId: nullableString(card.customer_id),
    orderId: nullableString(card.order_id),
    lineItemId: nullableString(card.line_item_id),
    createdAt: card.created_at
      ? new Date(card.created_at).toISOString().slice(0, 19).replace('T', ' ')
      : null,
  };
}

export function chooseShopifyGiftCardPlaceholder(
  plan: ShopifyGiftCardImportPlan,
  preferredCodeOwnerShopifyId: string | number | null | undefined,
): string {
  const owner = nullableString(preferredCodeOwnerShopifyId);
  return !owner || owner === plan.shopifyGiftCardId ? plan.preferredCode : plan.fallbackCode;
}

export function planObservedBalanceUpdate(input: {
  localBalance: number;
  previousProviderBalance: number | null;
  currentProviderBalance: number;
  unseenTransactionAmounts: number[];
}): { applyProviderBalance: boolean; state: 'matched' | 'review_required'; reason: string | null } {
  const cents = (value: number) => Math.round(value * 100);
  if (cents(input.localBalance) === cents(input.currentProviderBalance)) {
    return { applyProviderBalance: false, state: 'matched', reason: null };
  }
  if (input.previousProviderBalance != null) {
    const eventDelta = input.unseenTransactionAmounts.reduce((sum, amount) => sum + amount, 0);
    const eventsExplainProvider = cents(input.previousProviderBalance + eventDelta) === cents(input.currentProviderBalance);
    const localMatchesCheckpoint = cents(input.localBalance) === cents(input.previousProviderBalance);
    if (eventsExplainProvider && localMatchesCheckpoint) {
      return { applyProviderBalance: true, state: 'matched', reason: null };
    }
  }
  return {
    applyProviderBalance: false,
    state: 'review_required',
    reason: `Solvantis balance ${input.localBalance.toFixed(2)} differs from Shopify balance ${input.currentProviderBalance.toFixed(2)} and unseen Shopify transactions do not prove the full change.`,
  };
}