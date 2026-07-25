import { imsQuery } from '@/services/IMSMySQLService';

export const DEFAULT_BUSINESS_TIME_ZONE = 'Australia/Sydney';

export function isValidBusinessTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export async function getBusinessTimeZone(businessId: string): Promise<string> {
  const rows = await imsQuery<{ value: string | null }>(
    "SELECT value FROM ims_settings WHERE business_id = ? AND `key` = 'business_timezone' LIMIT 1",
    [businessId],
  );
  const timeZone = rows[0]?.value?.trim() ?? '';
  return isValidBusinessTimeZone(timeZone) ? timeZone : DEFAULT_BUSINESS_TIME_ZONE;
}