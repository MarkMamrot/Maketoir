import { isValidGeminiModelId } from '@/lib/website/contentPreferences';

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
  documentExtraction: 'gemini-2.5-pro',
  catalogueMatching: 'gemini-2.5-flash',
  businessIntelligence: 'gemini-2.5-flash',
  customerService: 'gemini-2.5-flash',
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
  if (configured && isValidGeminiModelId(configured)) return configured;
  if (source?.gemini_model && isValidGeminiModelId(source.gemini_model)) return source.gemini_model;
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
  if (entries.some(([, modelId]) => !isValidGeminiModelId(modelId))) return null;
  return Object.fromEntries(entries) as BusinessAiModelPreferences;
}