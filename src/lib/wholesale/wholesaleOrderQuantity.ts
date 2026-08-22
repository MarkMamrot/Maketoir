import type { WholesaleOrderQuantityMode } from './wholesalePortalSettings';

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