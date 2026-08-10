import { describe, expect, it } from 'vitest';
import { isValidGeminiModelId, measurementPrompt, resolveMeasurementSystem } from '../contentPreferences';

describe('Website content preferences', () => {
  it('uses metric for Australian organisations in automatic mode', () => {
    expect(resolveMeasurementSystem('auto', 'Australia/Sydney')).toBe('metric');
    expect(measurementPrompt('metric', 'Australia/Sydney')).toContain('1 inch = 2.54 cm');
  });

  it('uses imperial for configured US timezones and honours explicit overrides', () => {
    expect(resolveMeasurementSystem('auto', 'America/New_York')).toBe('imperial');
    expect(resolveMeasurementSystem('metric', 'America/New_York')).toBe('metric');
  });

  it('accepts Gemini model IDs without allowing arbitrary provider strings', () => {
    expect(isValidGeminiModelId('gemini-2.5-flash')).toBe(true);
    expect(isValidGeminiModelId('gpt-4o')).toBe(false);
    expect(isValidGeminiModelId('gemini-2.5-flash<script>')).toBe(false);
  });
});