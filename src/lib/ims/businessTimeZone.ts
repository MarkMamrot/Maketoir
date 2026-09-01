import { imsQuery } from '@/services/IMSMySQLService';
import { DEFAULT_BUSINESS_TIME_ZONE, isValidBusinessTimeZone } from '@/lib/ims/businessTimeZoneValue';

export { DEFAULT_BUSINESS_TIME_ZONE, isValidBusinessTimeZone } from '@/lib/ims/businessTimeZoneValue';

export async function getBusinessTimeZone(businessId: string): Promise<string> {
  const rows = await imsQuery<{ value: string | null }>(
    "SELECT value FROM ims_settings WHERE business_id = ? AND `key` = 'business_timezone' LIMIT 1",
    [businessId],
  );
  const timeZone = rows[0]?.value?.trim() ?? '';
  return isValidBusinessTimeZone(timeZone) ? timeZone : DEFAULT_BUSINESS_TIME_ZONE;
}