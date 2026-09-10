import type { WholesaleOrderQuantityMode } from './wholesalePortalSettings';

export function parseWholesalePackSizeInput(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const packSize = Number(value);
  if (!Number.isSafeInteger(packSize) || packSize < 1 || packSize > 100_000) {
    throw new Error('Wholesale selling pack size must be a whole number from 1 to 100,000.');
  }
  return packSize;
}

export function wholesalePackSize(packSize: number | null | undefined): number {
  const value = Number(packSize);
  return Number.isInteger(value) && value > 1 ? value : 1;
}

export function wholesaleEntryQuantityToUnits(
  entryQuantity: number,
  packSize: number | null | undefined,
  mode: WholesaleOrderQuantityMode,
): number {
  return entryQuantity * (mode === 'pack' ? wholesalePackSize(packSize) : 1);
}

export function wholesaleUnitsToEntryQuantity(
  units: number,
  packSize: number | null | undefined,
  mode: WholesaleOrderQuantityMode,
): number {
  return mode === 'pack' ? units / wholesalePackSize(packSize) : units;
}

export function isValidWholesaleUnitQuantity(
  units: number,
  packSize: number | null | undefined,
  mode: WholesaleOrderQuantityMode,
): boolean {
  return Number.isInteger(units) && units > 0 && (mode !== 'pack' || units % wholesalePackSize(packSize) === 0);
}