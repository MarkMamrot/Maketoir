export const DEFAULT_ALLOW_INCOMING_TRANSFER_SALES = true;

export function posLocationSettingsKey(locationId: number): string {
  return `pos_loc_${locationId}_settings`;
}

export function allowsIncomingTransferSales(value: string | null | undefined): boolean {
  if (!value) return DEFAULT_ALLOW_INCOMING_TRANSFER_SALES;
  try {
    return JSON.parse(value)?.allowIncomingTransferSales !== false;
  } catch {
    return DEFAULT_ALLOW_INCOMING_TRANSFER_SALES;
  }
}