import { describe, expect, it } from 'vitest';

import { CURATED_AI_MODELS, audMicrosFromUsd, curatedAiModel, hasCompleteCuratedPricing, isCuratedAiModel } from '../curatedModels';

describe('curated AI models', () => {
  it('contains exactly the six approved product models', () => {
    expect(CURATED_AI_MODELS.map(model => model.id)).toEqual([
      'gemini-3.7-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-image',
      'gemini-3-pro-image',
      'veo-3.1-generate-preview',
    ]);
  });

  it('filters by model kind and supplies customer-facing names', () => {
    expect(isCuratedAiModel('gemini-3.1-flash-image', 'image')).toBe(true);
    expect(isCuratedAiModel('gemini-3.1-flash-image', 'text')).toBe(false);
    expect(isCuratedAiModel('gemini-2.5-flash')).toBe(false);
    expect(curatedAiModel('gemini-3-pro-image')?.name).toBe('Nano Banana Pro');
  });

  it('converts published USD rates to AUD micros exactly and rounds up', () => {
    expect(audMicrosFromUsd('0.75', '1.52')).toBe(1_140_000n);
    expect(audMicrosFromUsd('0.10', '1.33333333')).toBe(133_334n);
    expect(() => audMicrosFromUsd('1', '0')).toThrow('greater than zero');
  });

  it('requires every manifest dimension before a curated model is priceable', () => {
    expect(hasCompleteCuratedPricing('veo-3.1-generate-preview', ['video_second'])).toBe(true);
    expect(hasCompleteCuratedPricing('gemini-3.1-flash-image', ['input_tokens', 'output_image_tokens'])).toBe(false);
    expect(hasCompleteCuratedPricing('gemini-3.1-flash-image', curatedAiModel('gemini-3.1-flash-image')!.rates.map(rate => rate.metric))).toBe(true);
  });
});