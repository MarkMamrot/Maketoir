export const MARKETING_SCHEDULED_AUTOMATION_KEY = 'MarketingScheduledAutomationEnabled';

export function isMarketingScheduledAutomationEnabled(value: string | null | undefined): boolean {
  return value !== 'false';
}