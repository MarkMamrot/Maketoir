export class WholesaleLocationValidationError extends Error {}

export function normalizeWholesaleLocationName(value: unknown): string {
  if (typeof value !== 'string') throw new WholesaleLocationValidationError('Enter a location name.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120) throw new WholesaleLocationValidationError('Location name must be between 1 and 120 characters.');
  return name;
}

export function normalizeWholesaleLocationIds(value: unknown): number[] {
  if (!Array.isArray(value)) throw new WholesaleLocationValidationError('Select at least one buying location.');
  const ids = [...new Set(value.map(Number))];
  if (!ids.length || ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new WholesaleLocationValidationError('Select between 1 and 100 valid buying locations.');
  }
  return ids;
}