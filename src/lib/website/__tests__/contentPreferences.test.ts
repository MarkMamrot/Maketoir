import { describe, expect, it } from 'vitest';
import { DEFAULT_URL_JUDGE_MODEL, DEFAULT_WEBSITE_CONTENT_MODEL, isValidGeminiModelId, measurementPrompt, resolveMeasurementSystem, resolveWebsiteTextModel } from '../contentPreferences';

describe('Website content preferences', () => {
  it('uses metric for Australian organisations in automatic mode', () => {
    expect(resolveMeasurementSystem('auto', 'Australia/Sydney')).toBe('metric');
    expect(measurementPrompt('metric', 'Australia/Sydney')).toContain('1 inch = 2.54 cm');
  });

  it('uses imperial for configured US timezones and honours explicit overrides', () => {
    expect(resolveMeasurementSystem('auto', 'America/New_York')).toBe('imperial');
    expect(resolveMeasurementSystem('metric', 'America/New_York')).toBe('metric');
  });

  it('accepts only curated Gemini text models and replaces stale settings', () => {
    expect(isValidGeminiModelId('gemini-3.7-flash')).toBe(true);
    expect(isValidGeminiModelId('gemini-2.5-flash')).toBe(false);
    expect(isValidGeminiModelId('gpt-4o')).toBe(false);
    expect(isValidGeminiModelId('gemini-2.5-flash<script>')).toBe(false);
    expect(resolveWebsiteTextModel('gemini-2.5-flash', DEFAULT_WEBSITE_CONTENT_MODEL)).toBe('gemini-3.7-flash');
    expect(resolveWebsiteTextModel('gemini-3.5-flash-lite', DEFAULT_URL_JUDGE_MODEL)).toBe('gemini-3.5-flash-lite');
  });
});