import type { AiRateMetric } from './types';

export type AiModelCapability = 'text' | 'image' | 'video';
export type AiModelLifecycle = 'active' | 'preview' | 'deprecated' | 'retired';

export type CanonicalAiModel = {
  provider: 'google';
  modelId: string;
  displayName: string;
  version: string | null;
  supportedGenerationMethods: string[];
  inputModalities: string[];
  outputModalities: string[];
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
  lifecycleStatus: AiModelLifecycle;
};

export type BillingFamilyMapping = {
  id?: number;
  provider: 'google';
  modelId: string;
  familyPattern: string;
  matchType: 'contains' | 'regex';
  mappingVersion: number;
  isActive: boolean;
};

export const DEFAULT_BILLING_FAMILY_MAPPINGS: BillingFamilyMapping[] = [
  { provider: 'google', modelId: 'gemini-3.1-pro-preview', familyPattern: 'gemini 3.1 pro preview', matchType: 'contains', mappingVersion: 1, isActive: true },
  { provider: 'google', modelId: 'gemini-3.1-pro-preview', familyPattern: 'gemini 3.0 / 3.1 pro', matchType: 'contains', mappingVersion: 1, isActive: true },
  { provider: 'google', modelId: 'gemini-3.1-pro-preview', familyPattern: 'gemini 3 pro', matchType: 'contains', mappingVersion: 1, isActive: true },
  { provider: 'google', modelId: 'gemini-3.1-flash-lite-image', familyPattern: 'gemini 3.1 flash lite image', matchType: 'contains', mappingVersion: 1, isActive: true },
  { provider: 'google', modelId: 'gemini-3.1-flash-image', familyPattern: 'gemini 3.1 flash image', matchType: 'contains', mappingVersion: 1, isActive: true },
  { provider: 'google', modelId: 'gemini-3-pro-image', familyPattern: 'gemini 3 pro image', matchType: 'contains', mappingVersion: 1, isActive: true },
  { provider: 'google', modelId: 'gemini-2.5-flash-image', familyPattern: 'gemini 2.5 flash image', matchType: 'contains', mappingVersion: 1, isActive: true },
  { provider: 'google', modelId: 'gemini-2.5-flash-lite', familyPattern: 'gemini 2.5 flash lite', matchType: 'contains', mappingVersion: 1, isActive: true },
  { provider: 'google', modelId: 'gemini-2.5-flash', familyPattern: 'gemini 2.5 flash', matchType: 'contains', mappingVersion: 1, isActive: true },
  { provider: 'google', modelId: 'gemini-2.5-pro', familyPattern: 'gemini 2.5 pro', matchType: 'contains', mappingVersion: 1, isActive: true },
  { provider: 'google', modelId: 'gemini-2.0-flash-lite', familyPattern: 'gemini 2.0 flash lite', matchType: 'contains', mappingVersion: 1, isActive: true },
  { provider: 'google', modelId: 'gemini-2.0-flash', familyPattern: 'gemini 2.0 flash', matchType: 'contains', mappingVersion: 1, isActive: true },
];

const normalizedModelId = (name: unknown) => String(name || '').replace(/^models\//, '').trim();
const stringArray = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];

export function normalizeGoogleModel(raw: any): CanonicalAiModel | null {
  const modelId = normalizedModelId(raw?.name);
  if (!modelId) return null;
  const supportedGenerationMethods = stringArray(raw?.supportedGenerationMethods || raw?.supportedActions);
  let inputModalities = stringArray(raw?.inputModalities || raw?.supportedInputModalities).map(value => value.toLowerCase());
  let outputModalities = stringArray(raw?.outputModalities || raw?.supportedOutputModalities).map(value => value.toLowerCase());
  if (!inputModalities.length || !outputModalities.length) {
    const hint = `${modelId} ${raw?.displayName || ''}`.toLowerCase();
    if (/veo|video/.test(hint)) { if (!inputModalities.length) inputModalities = ['text', 'image']; if (!outputModalities.length) outputModalities = ['video']; }
    else if (/image|imagen|banana/.test(hint)) { if (!inputModalities.length) inputModalities = ['text', 'image']; if (!outputModalities.length) outputModalities = ['image']; }
    else { if (!inputModalities.length) inputModalities = ['text']; if (!outputModalities.length) outputModalities = ['text']; }
  }
  const description = `${raw?.displayName || ''} ${raw?.description || ''}`.toLowerCase();
  const lifecycleStatus: AiModelLifecycle = /deprecated|legacy|retir/.test(description)
    ? 'deprecated'
    : /preview|experimental/.test(`${modelId} ${description}`)
      ? 'preview'
      : 'active';
  return {
    provider: 'google',
    modelId,
    displayName: String(raw?.displayName || modelId),
    version: raw?.version ? String(raw.version) : null,
    supportedGenerationMethods,
    inputModalities,
    outputModalities,
    inputTokenLimit: Number.isSafeInteger(Number(raw?.inputTokenLimit)) ? Number(raw.inputTokenLimit) : null,
    outputTokenLimit: Number.isSafeInteger(Number(raw?.outputTokenLimit)) ? Number(raw.outputTokenLimit) : null,
    lifecycleStatus,
  };
}

export function modelCapability(model: Pick<CanonicalAiModel, 'modelId' | 'supportedGenerationMethods' | 'outputModalities'>): AiModelCapability | null {
  const methods = model.supportedGenerationMethods.join(' ').toLowerCase();
  const outputs = model.outputModalities.join(' ').toLowerCase();
  if (/embed|tts|live|robotics|lyria|aqa/.test(`${model.modelId} ${methods}`)) return null;
  if (/video|veo/.test(`${model.modelId} ${methods} ${outputs}`)) return 'video';
  if (/image/.test(`${model.modelId} ${methods} ${outputs}`)) return 'image';
  if (/generatecontent|generate content|text|chat/.test(methods) || /^gemini-/.test(model.modelId)) return 'text';
  return null;
}

export function requiredPricingMetrics(model: CanonicalAiModel): AiRateMetric[] {
  const capability = modelCapability(model);
  if (capability === 'video') return ['video_second'];
  if (capability === 'image') return ['input_tokens', 'output_image_tokens'];
  if (capability !== 'text') return [];
  const required: AiRateMetric[] = ['input_tokens', 'output_tokens', 'thinking_tokens'];
  if (model.supportedGenerationMethods.some(method => method.toLowerCase() === 'createcachedcontent')) required.push('cached_input_tokens');
  return required;
}

export function pricingCompleteness(model: CanonicalAiModel, activeMetrics: Iterable<AiRateMetric>) {
  const present = new Set(activeMetrics);
  const requiredMetrics = requiredPricingMetrics(model);
  if ([...present].some(metric => metric.endsWith('_over_200k'))) {
    requiredMetrics.push('input_tokens_over_200k', 'output_tokens_over_200k', 'thinking_tokens_over_200k');
    if (requiredMetrics.includes('cached_input_tokens')) requiredMetrics.push('cached_input_tokens_over_200k');
  }
  const missingMetrics = requiredMetrics.filter(metric => !present.has(metric));
  return { complete: requiredMetrics.length > 0 && missingMetrics.length === 0, requiredMetrics, missingMetrics };
}

export function resolveBillingFamily(skuName: string, mappings: BillingFamilyMapping[]): BillingFamilyMapping | null {
  const active = mappings.filter(mapping => mapping.isActive).sort((left, right) => right.mappingVersion - left.mappingVersion || right.familyPattern.length - left.familyPattern.length || (left.id || 0) - (right.id || 0));
  const normalizedSkuName = skuName.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const mapping of active) {
    if (mapping.matchType === 'contains' && normalizedSkuName.toLowerCase().includes(mapping.familyPattern.toLowerCase())) return mapping;
    if (mapping.matchType === 'regex') {
      try { if (new RegExp(mapping.familyPattern, 'i').test(normalizedSkuName)) return mapping; }
      catch { continue; }
    }
  }
  return null;
}