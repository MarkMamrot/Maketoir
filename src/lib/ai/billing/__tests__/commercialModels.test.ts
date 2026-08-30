import { describe, expect, it } from 'vitest';
import { classifyAiModel, displayAiModelName } from '../commercialModels';

describe('commercial AI models', () => {
  it('classifies provider model IDs for tenant dropdowns', () => {
    expect(classifyAiModel('gemini-3.1-pro-preview')).toBe('text');
    expect(classifyAiModel('gemini-3.1-flash-image')).toBe('image');
    expect(classifyAiModel('veo-3.1-generate-preview')).toBe('video');
  });

  it('creates a readable fallback display name', () => {
    expect(displayAiModelName('gemini-3.1-pro-preview')).toBe('Gemini 3.1 Pro Preview');
  });
});