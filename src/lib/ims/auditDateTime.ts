import { DEFAULT_BUSINESS_TIME_ZONE, isValidBusinessTimeZone } from '@/lib/ims/businessTimeZoneValue';

export { DEFAULT_BUSINESS_TIME_ZONE } from '@/lib/ims/businessTimeZoneValue';

const EXPLICIT_TIME_ZONE_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function formatAuditDateTime(
  value: string,
  timeZone = DEFAULT_BUSINESS_TIME_ZONE,
): string {
  const normalizedTimeZone = isValidBusinessTimeZone(timeZone) ? timeZone : DEFAULT_BUSINESS_TIME_ZONE;
  const trimmed = value.trim();
  const normalizedValue = EXPLICIT_TIME_ZONE_PATTERN.test(trimmed)
    ? trimmed
    : `${trimmed.replace(' ', 'T')}Z`;
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: normalizedTimeZone,
  });
}