import { isCuratedAiModel } from '@/lib/ai/billing/curatedModels';

export const BUSINESS_AI_MODEL_KEYS = [
  'documentExtraction',
  'catalogueMatching',
  'businessIntelligence',
  'customerService',
] as const;

export type BusinessAiModelKey = typeof BUSINESS_AI_MODEL_KEYS[number];

export type BusinessAiModelPreferences = Record<BusinessAiModelKey, string>;

export type BusinessAiModelSource = {
  gemini_model?: string | null;
  ai_document_extraction_model?: string | null;
  ai_catalogue_matching_model?: string | null;
  ai_business_intelligence_model?: string | null;
  ai_customer_service_model?: string | null;
};

export const DEFAULT_BUSINESS_AI_MODELS: BusinessAiModelPreferences = {
  documentExtraction: 'gemini-3.1-pro-preview',
  catalogueMatching: 'gemini-3.7-flash',
  businessIntelligence: 'gemini-3.7-flash',
  customerService: 'gemini-3.5-flash-lite',
};

export const BUSINESS_AI_MODEL_COLUMNS: Record<BusinessAiModelKey, keyof BusinessAiModelSource> = {
  documentExtraction: 'ai_document_extraction_model',
  catalogueMatching: 'ai_catalogue_matching_model',
  businessIntelligence: 'ai_business_intelligence_model',
  customerService: 'ai_customer_service_model',
};

export function resolveBusinessAiModel(
  source: BusinessAiModelSource | null | undefined,
  key: BusinessAiModelKey,
): string {
  const configured = source?.[BUSINESS_AI_MODEL_COLUMNS[key]];
  if (configured && isCuratedAiModel(configured, 'text')) return configured;
  if (source?.gemini_model && isCuratedAiModel(source.gemini_model, 'text')) return source.gemini_model;
  return DEFAULT_BUSINESS_AI_MODELS[key];
}

export function getBusinessAiModelPreferences(
  source: BusinessAiModelSource | null | undefined,
): BusinessAiModelPreferences {
  return Object.fromEntries(
    BUSINESS_AI_MODEL_KEYS.map(key => [key, resolveBusinessAiModel(source, key)]),
  ) as BusinessAiModelPreferences;
}

export function validateBusinessAiModelPreferences(value: unknown): BusinessAiModelPreferences | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const entries = BUSINESS_AI_MODEL_KEYS.map(key => [key, typeof record[key] === 'string' ? record[key].trim() : ''] as const);
  if (entries.some(([, modelId]) => !isCuratedAiModel(modelId, 'text'))) return null;
  return Object.fromEntries(entries) as BusinessAiModelPreferences;
}