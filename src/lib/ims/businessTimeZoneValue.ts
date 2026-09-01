export const DEFAULT_BUSINESS_TIME_ZONE = 'Australia/Sydney';

export function isValidBusinessTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}