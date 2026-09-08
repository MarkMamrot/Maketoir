import { buildQuantity, ProductBuildValidationError } from './domain';
import { imsQuery } from '@/services/IMSMySQLService';

export const BUILD_FROM_SALE_SETTING_KEY = 'build_from_sale_enabled';
export const DEFAULT_BUILD_FROM_SALE_SETTING = 'no';

export function buildFromSaleLocationSettingKey(locationId: number): string {
  if (!Number.isInteger(locationId) || locationId <= 0) throw new ProductBuildValidationError('A valid location is required.');
  return `build_from_sale_location:${locationId}`;
}

export type BuildFromSaleOverride = 'inherit' | 'enabled' | 'disabled';

export interface BuildFromSalePolicy {
  businessValue: 'yes' | 'no';
  locationValue: BuildFromSaleOverride;
  enabled: boolean;
}

export interface BuildFromSaleLine {
  variantId: string;
  quantity: number;
  sourceLineId?: string | null;
}

export interface BuildFromSalePlanItem {
  outputVariantId: string;
  requestedQuantity: number;
  usableFinishedQuantity: number;
  shortfall: number;
  sourceLineIds: string[];
}

export function parseBuildFromSaleOverride(value: unknown): BuildFromSaleOverride {
  return value === 'enabled' || value === 'disabled' ? value : 'inherit';
}

export function isBuildFromSaleEnabled(businessValue: unknown, locationValue?: unknown): boolean {
  const override = parseBuildFromSaleOverride(locationValue);
  if (override !== 'inherit') return override === 'enabled';
  return businessValue === 'yes';
}

export function calculateBuildFromSaleShortfall(requestedQuantity: number, usableFinishedQuantity: number): number {
  const requested = buildQuantity(requestedQuantity, 'Requested quantity');
  const usable = buildQuantity(usableFinishedQuantity, 'Usable finished quantity');
  if (requested < 0 || usable < 0) throw new ProductBuildValidationError('Sale quantities cannot be negative.');
  return buildQuantity(Math.max(0, requested - usable));
}

export function validateBuildFromSaleSetting(key: string, value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (key === BUILD_FROM_SALE_SETTING_KEY) {
    if (normalized !== 'yes' && normalized !== 'no') throw new ProductBuildValidationError('Build from sale must be yes or no.');
    return normalized;
  }
  if (/^build_from_sale_location:\d+$/.test(key)) {
    if (!['inherit', 'enabled', 'disabled'].includes(normalized)) {
      throw new ProductBuildValidationError('Location build from sale must be inherit, enabled, or disabled.');
    }
    return normalized;
  }
  return null;
}

export async function resolveBuildFromSalePolicy(businessId: string, locationId: number): Promise<BuildFromSalePolicy> {
  const locationKey = buildFromSaleLocationSettingKey(locationId);
  const rows = await imsQuery<{ key: string; value: string }>(
    'SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` IN (?, ?)',
    [businessId, BUILD_FROM_SALE_SETTING_KEY, locationKey],
  );
  const settings = new Map(rows.map(row => [String(row.key), String(row.value ?? '')]));
  const businessValue = settings.get(BUILD_FROM_SALE_SETTING_KEY) === 'yes' ? 'yes' : DEFAULT_BUILD_FROM_SALE_SETTING;
  const locationValue = parseBuildFromSaleOverride(settings.get(locationKey));
  return { businessValue, locationValue, enabled: isBuildFromSaleEnabled(businessValue, locationValue) };
}

export function planBuildFromSaleShortfalls(
  lines: BuildFromSaleLine[],
  usableFinishedByVariant: ReadonlyMap<string, number>,
): BuildFromSalePlanItem[] {
  const grouped = new Map<string, { requestedQuantity: number; sourceLineIds: Set<string> }>();
  for (const line of lines) {
    const variantId = String(line.variantId ?? '').trim();
    if (!variantId) throw new ProductBuildValidationError('Every sale line requires a variant.');
    const quantity = buildQuantity(line.quantity, 'Sale quantity');
    if (quantity < 0) throw new ProductBuildValidationError('Sale quantities cannot be negative.');
    const current = grouped.get(variantId) ?? { requestedQuantity: 0, sourceLineIds: new Set<string>() };
    current.requestedQuantity = buildQuantity(current.requestedQuantity + quantity);
    const sourceLineId = String(line.sourceLineId ?? '').trim();
    if (sourceLineId) current.sourceLineIds.add(sourceLineId);
    grouped.set(variantId, current);
  }
  return [...grouped.entries()].map(([outputVariantId, item]) => {
    const usableFinishedQuantity = buildQuantity(usableFinishedByVariant.get(outputVariantId) ?? 0, 'Usable finished quantity');
    return {
      outputVariantId,
      requestedQuantity: item.requestedQuantity,
      usableFinishedQuantity,
      shortfall: calculateBuildFromSaleShortfall(item.requestedQuantity, usableFinishedQuantity),
      sourceLineIds: [...item.sourceLineIds],
    };
  }).filter(item => item.shortfall > 0);
}