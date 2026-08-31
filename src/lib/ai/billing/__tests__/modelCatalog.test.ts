import { describe, expect, it } from 'vitest';
import { normalizeGoogleModel, pricingCompleteness, resolveBillingFamily } from '../modelCatalog';

describe('AI model catalog policy', () => {
  it('normalizes canonical Google model metadata and lifecycle', () => {
    expect(normalizeGoogleModel({
      name: 'models/gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview', version: '3.1',
      supportedGenerationMethods: ['generateContent'], inputModalities: ['TEXT', 'IMAGE'], outputModalities: ['TEXT'],
      inputTokenLimit: 1_048_576, outputTokenLimit: 65_536,
    })).toEqual(expect.objectContaining({ modelId: 'gemini-3.1-pro-preview', lifecycleStatus: 'preview', inputModalities: ['text', 'image'], inputTokenLimit: 1_048_576 }));
  });

  it('retains conservative capability modalities when Google omits them', () => {
    expect(normalizeGoogleModel({ name: 'models/veo-3.1-generate-preview', supportedGenerationMethods: ['predictLongRunning'] })).toEqual(expect.objectContaining({ inputModalities: ['text', 'image'], outputModalities: ['video'] }));
  });

  it('resolves new billing labels from versioned mapping data', () => {
    const mappings = [{ provider: 'google' as const, modelId: 'gemini-3.1-pro-preview', familyPattern: 'Gemini 3.0 / 3.1 Pro', matchType: 'contains' as const, mappingVersion: 2, isActive: true }];
    expect(resolveBillingFamily('Gemini 3.0 / 3.1 Pro Text Input', mappings)?.modelId).toBe('gemini-3.1-pro-preview');
  });

  it('requires complete text pricing including long-context rates', () => {
    const model = normalizeGoogleModel({ name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent', 'createCachedContent'], inputTokenLimit: 1_000_000 })!;
    const incomplete = pricingCompleteness(model, ['input_tokens', 'cached_input_tokens', 'output_tokens', 'thinking_tokens', 'input_tokens_over_200k']);
    expect(incomplete.complete).toBe(false);
    expect(incomplete.missingMetrics).toContain('output_tokens_over_200k');
    expect(pricingCompleteness(model, [...incomplete.requiredMetrics]).complete).toBe(true);
  });
});