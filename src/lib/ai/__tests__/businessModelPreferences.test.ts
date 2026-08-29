import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUSINESS_AI_MODELS,
  getBusinessAiModelPreferences,
  resolveBusinessAiModel,
  validateBusinessAiModelPreferences,
} from '../businessModelPreferences';

describe('business AI model preferences', () => {
  it('uses Pro for document extraction and Flash for lower-risk functions by default', () => {
    expect(getBusinessAiModelPreferences(null)).toEqual(DEFAULT_BUSINESS_AI_MODELS);
  });

  it('prefers a function-specific model over the legacy tenant model', () => {
    expect(resolveBusinessAiModel({
      gemini_model: 'gemini-legacy',
      ai_document_extraction_model: 'gemini-document',
    }, 'documentExtraction')).toBe('gemini-document');
  });

  it('uses the legacy tenant model while a business has no function-specific selection', () => {
    expect(resolveBusinessAiModel({ gemini_model: 'gemini-legacy' }, 'catalogueMatching')).toBe('gemini-legacy');
  });

  it('rejects incomplete or invalid preference payloads', () => {
    expect(validateBusinessAiModelPreferences({ documentExtraction: 'not-a-model' })).toBeNull();
    expect(validateBusinessAiModelPreferences({
      documentExtraction: 'gemini-2.5-pro',
      catalogueMatching: 'gemini-2.5-flash',
      businessIntelligence: 'gemini-2.5-flash',
      customerService: 'gemini-2.5-flash',
    })).toEqual(DEFAULT_BUSINESS_AI_MODELS);
  });
});