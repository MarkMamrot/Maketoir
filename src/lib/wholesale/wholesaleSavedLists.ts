export type WholesaleSavedListItemInput = {
  variantId: string;
  quantity: number;
};

export class WholesaleSavedListValidationError extends Error {}

export function normalizeWholesaleSavedListName(value: unknown): string {
  if (typeof value !== 'string') throw new WholesaleSavedListValidationError('Enter a list name.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw new WholesaleSavedListValidationError('Enter a list name.');
  if (name.length > 80) throw new WholesaleSavedListValidationError('List names must be 80 characters or fewer.');
  return name;
}

export function normalizeWholesaleSavedListItems(value: unknown): WholesaleSavedListItemInput[] {
  if (!Array.isArray(value)) throw new WholesaleSavedListValidationError('List items are required.');
  if (value.length > 250) throw new WholesaleSavedListValidationError('A saved list can contain up to 250 variants.');

  const items = new Map<string, number>();
  for (const rawItem of value) {
    if (!rawItem || typeof rawItem !== 'object') throw new WholesaleSavedListValidationError('Each list item must be valid.');
    const item = rawItem as Record<string, unknown>;
    const variantId = typeof item.variantId === 'string' ? item.variantId.trim() : '';
    const quantity = Number(item.quantity);
    if (!variantId || variantId.length > 64) throw new WholesaleSavedListValidationError('Each list item needs a valid variant.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
      throw new WholesaleSavedListValidationError('List quantities must be whole numbers between 1 and 9,999.');
    }
    if (items.has(variantId)) throw new WholesaleSavedListValidationError('Each variant can appear only once in a saved list.');
    items.set(variantId, quantity);
  }

  return Array.from(items, ([variantId, quantity]) => ({ variantId, quantity }));
}