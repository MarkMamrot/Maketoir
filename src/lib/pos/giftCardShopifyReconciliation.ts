export type ShopifyGiftCardCandidate = {
  id: number;
  last_characters: string;
  initial_value: string;
  balance: string;
  currency: string;
  disabled_at: string | null;
  expires_on: string | null;
};

export function isShopifyGiftCardCodeTakenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('Shopify 422 POST /gift_cards.json') &&
    /"code"\s*:\s*\[\s*"has already been taken"\s*\]/i.test(message);
}

export function findUniqueUnusedShopifyGiftCard(
  candidates: ShopifyGiftCardCandidate[],
  code: string,
  amount: number,
  currency = 'AUD',
): ShopifyGiftCardCandidate | null {
  const lastCharacters = code.trim().slice(-4).toLowerCase();
  if (lastCharacters.length !== 4 || candidates.length !== 1) return null;

  const candidate = candidates[0];
  const amountInCents = Math.round(amount * 100);
  const initialValueInCents = Math.round(Number(candidate.initial_value) * 100);
  const balanceInCents = Math.round(Number(candidate.balance) * 100);
  if (
    candidate.disabled_at ||
    candidate.last_characters.toLowerCase() !== lastCharacters ||
    candidate.currency.toUpperCase() !== currency.toUpperCase() ||
    !Number.isFinite(initialValueInCents) ||
    !Number.isFinite(balanceInCents) ||
    initialValueInCents !== amountInCents ||
    balanceInCents !== amountInCents
  ) {
    return null;
  }

  return candidate;
}