export interface ChannelBuildCapacityPolicy {
  enabled: boolean;
  inventoryLocationIds: number[];
}

export class ChannelBuildCapacityPolicyError extends Error {}

export function normalizeChannelInventoryLocationIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const locationIds = value.map(item => Math.floor(Number(item)));
  if (locationIds.some(locationId => !Number.isInteger(locationId) || locationId <= 0)) {
    throw new ChannelBuildCapacityPolicyError('Channel inventory locations must contain valid location IDs.');
  }
  return [...new Set(locationIds)];
}

export function resolveChannelBuildCapacityPolicy(
  settings: Readonly<Record<string, unknown>>,
  fallbackLocationIds: ReadonlyArray<number> = [],
): ChannelBuildCapacityPolicy {
  const configuredLocations = normalizeChannelInventoryLocationIds(settings.inventoryLocationIds);
  return {
    enabled: settings.buildCapacityEnabled === true || settings.buildCapacityEnabled === 1,
    inventoryLocationIds: configuredLocations.length
      ? configuredLocations
      : normalizeChannelInventoryLocationIds([...fallbackLocationIds]),
  };
}