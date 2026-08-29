import { describe, expect, it } from 'vitest';
import { calculateRateCharge, normalizeUsageMetadata } from '../service';

describe('AI usage pricing', () => {
  it('normalizes Gemini usage metadata', () => {
    expect(normalizeUsageMetadata({ promptTokenCount: 100, cachedContentTokenCount: 20, candidatesTokenCount: 30, thoughtsTokenCount: 4 })).toEqual({
      inputTokens: 100, cachedInputTokens: 20, outputTokens: 30, thinkingTokens: 4, outputImages: 0, videoSeconds: 0,
    });
  });

  it('prices each metric using its configured scale', () => {
    const units = { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 500_000, thinkingTokens: 0, outputImages: 0, videoSeconds: 0 };
    expect(calculateRateCharge(units, [
      { metric: 'input_tokens', price_per_unit_micros: '2000000', unit_scale: 1_000_000 } as any,
      { metric: 'output_tokens', price_per_unit_micros: '8000000', unit_scale: 1_000_000 } as any,
    ])).toBe(6_000_000n);
  });
});