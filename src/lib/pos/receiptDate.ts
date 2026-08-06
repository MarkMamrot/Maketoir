import { DEFAULT_BUSINESS_TIME_ZONE, isValidBusinessTimeZone } from '@/lib/ims/businessTimeZone';

const ZONED_DATE_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function formatReceiptDate(
  value: string,
  timeZone = DEFAULT_BUSINESS_TIME_ZONE,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' },
): string {
  const businessTimeZone = isValidBusinessTimeZone(timeZone) ? timeZone : DEFAULT_BUSINESS_TIME_ZONE;
  const hasExplicitTimeZone = ZONED_DATE_PATTERN.test(value.trim());
  const normalizedValue = hasExplicitTimeZone
    ? value
    : `${value.trim().replace(' ', 'T')}Z`;
  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('en-AU', {
    ...options,
    timeZone: hasExplicitTimeZone ? businessTimeZone : 'UTC',
  });
}