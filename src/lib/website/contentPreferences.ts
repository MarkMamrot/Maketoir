export const WEBSITE_AI_SETTING_KEYS = {
  contentModel: 'ai_website_content_model',
  urlJudgeModel: 'ai_url_judge_model',
  measurementSystem: 'ai_measurement_system',
} as const;

export const DEFAULT_WEBSITE_CONTENT_MODEL = 'gemini-2.5-flash';
export const DEFAULT_URL_JUDGE_MODEL = 'gemini-2.5-flash';

export type MeasurementSystemPreference = 'auto' | 'metric' | 'imperial';
export type MeasurementSystem = 'metric' | 'imperial';

const IMPERIAL_TIME_ZONES = new Set([
  'America/Anchorage',
  'America/Chicago',
  'America/Denver',
  'America/Detroit',
  'America/Indiana/Indianapolis',
  'America/Los_Angeles',
  'America/New_York',
  'America/Phoenix',
  'America/Boise',
  'Pacific/Honolulu',
]);

export function isValidGeminiModelId(value: string): boolean {
  return /^gemini-[a-z0-9][a-z0-9.-]{0,99}$/.test(value.trim());
}

export function resolveMeasurementSystem(
  preference: string | null | undefined,
  timeZone: string | null | undefined,
): MeasurementSystem {
  if (preference === 'metric' || preference === 'imperial') return preference;
  return IMPERIAL_TIME_ZONES.has(String(timeZone ?? '').trim()) ? 'imperial' : 'metric';
}

export function measurementPrompt(system: MeasurementSystem, timeZone: string): string {
  if (system === 'imperial') {
    return `ORGANISATION MEASUREMENT UNITS (mandatory):
- Organisation timezone: ${timeZone || 'not configured'}
- Use imperial units for every measurement: inches/feet for dimensions and ounces/pounds for weight.
- Convert metric source measurements accurately and round sensibly for retail copy.
- Do not invent a measurement that is absent from the approved source facts.`;
  }
  return `ORGANISATION MEASUREMENT UNITS (mandatory):
- Organisation timezone: ${timeZone || 'not configured'}
- Use metric units for every measurement: mm/cm/m for dimensions and g/kg for weight.
- Convert imperial source measurements accurately (1 inch = 2.54 cm; 1 foot = 30.48 cm; 1 oz = 28.3495 g; 1 lb = 0.453592 kg) and round sensibly for retail copy.
- Do not output inches, feet, ounces, or pounds.
- Do not invent a measurement that is absent from the approved source facts.`;
}