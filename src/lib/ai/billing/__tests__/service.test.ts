import { describe, expect, it } from 'vitest';
import { calculateRateCharge, normalizeUsageMetadata } from '../service';

describe('AI usage pricing', () => {
  it('normalizes Gemini usage metadata', () => {
    expect(normalizeUsageMetadata({ promptTokenCount: 100, cachedContentTokenCount: 20, candidatesTokenCount: 30, thoughtsTokenCount: 4 })).toEqual({
        inputTokens: 80, cachedInputTokens: 20, outputTokens: 30, thinkingTokens: 4, outputImageTokens: 0, outputImages: 0, videoSeconds: 0,
    });
  });

  it('prices cached input separately from the uncached prompt', () => {
    const units = normalizeUsageMetadata({ promptTokenCount: 1_000_000, cachedContentTokenCount: 250_000 });
    expect(calculateRateCharge(units, [
      { metric: 'input_tokens', price_per_unit_micros: '300000', unit_scale: 1_000_000 } as any,
      { metric: 'cached_input_tokens', price_per_unit_micros: '30000', unit_scale: 1_000_000 } as any,
    ])).toBe(232_500n);
  });

  it('prices each metric using its configured scale', () => {
    const units = { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 500_000, thinkingTokens: 0, outputImageTokens: 0, outputImages: 0, videoSeconds: 0 };
    expect(calculateRateCharge(units, [
      { metric: 'input_tokens', price_per_unit_micros: '2000000', unit_scale: 1_000_000 } as any,
      { metric: 'output_tokens', price_per_unit_micros: '8000000', unit_scale: 1_000_000 } as any,
    ])).toBe(6_000_000n);
  });

  it('separates image output tokens from text output tokens', () => {
    expect(normalizeUsageMetadata({ candidatesTokenCount: 1150, candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 30 }, { modality: 'IMAGE', tokenCount: 1120 }] })).toEqual(
      expect.objectContaining({ outputTokens: 30, outputImageTokens: 1120 }),
    );
  });

  it('uses the long-context rate set only above 200k prompt tokens', () => {
    const rates = [
      { metric: 'input_tokens', price_per_unit_micros: '1000000', unit_scale: 1_000_000 },
      { metric: 'input_tokens_over_200k', price_per_unit_micros: '2000000', unit_scale: 1_000_000 },
    ] as any;
    const base = { cachedInputTokens: 0, outputTokens: 0, thinkingTokens: 0, outputImageTokens: 0, outputImages: 0, videoSeconds: 0 };
    expect(calculateRateCharge({ ...base, inputTokens: 200_000 }, rates)).toBe(200_000n);
    expect(calculateRateCharge({ ...base, inputTokens: 200_001 }, rates)).toBe(400_002n);
  });

  it('keeps a standard token rate when that metric has no long-context replacement', () => {
    const units = { inputTokens: 200_001, cachedInputTokens: 10_000, outputTokens: 0, thinkingTokens: 0, outputImageTokens: 0, outputImages: 0, videoSeconds: 0 };
    const rates = [
      { metric: 'input_tokens', price_per_unit_micros: '1000000', unit_scale: 1_000_000 },
      { metric: 'input_tokens_over_200k', price_per_unit_micros: '2000000', unit_scale: 1_000_000 },
      { metric: 'cached_input_tokens', price_per_unit_micros: '100000', unit_scale: 1_000_000 },
    ] as any;
    expect(calculateRateCharge(units, rates)).toBe(401_002n);
  });
});