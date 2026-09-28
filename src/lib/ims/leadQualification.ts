export const LEAD_TEMPERATURES = ['cold', 'warm', 'hot'] as const;

export type LeadTemperature = typeof LEAD_TEMPERATURES[number];

export function isLeadTemperature(value: unknown): value is LeadTemperature {
  return typeof value === 'string' && LEAD_TEMPERATURES.includes(value as LeadTemperature);
}

export function resolveLeadTemperature(
  type: string,
  temperature: unknown,
): LeadTemperature | null {
  if (type !== 'lead') return null;
  if (temperature === undefined || temperature === null || temperature === '') return 'warm';
  if (!isLeadTemperature(temperature)) throw new Error('Lead temperature must be cold, warm, or hot.');
  return temperature;
}