import type { AiModelKind } from './commercialModels';
import type { AiRateMetric } from './types';

export type CuratedAiRate = {
  metric: AiRateMetric;
  usdPrice: string;
  unitScale: number;
};

export type CuratedAiModel = {
  id: string;
  name: string;
  kind: AiModelKind;
  role: string;
  rates: readonly CuratedAiRate[];
  pricingNote?: string;
  reviewAfter?: string;
};

export const CURATED_AI_MODELS: readonly CuratedAiModel[] = [
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', kind: 'text', role: 'Recent general-purpose model', pricingNote: 'Promotional pricing through 31 December 2026.', reviewAfter: '2026-12-31', rates: [
    { metric: 'input_tokens', usdPrice: '0.75', unitScale: 1_000_000 }, { metric: 'cached_input_tokens', usdPrice: '0.075', unitScale: 1_000_000 },
    { metric: 'output_tokens', usdPrice: '3.75', unitScale: 1_000_000 }, { metric: 'thinking_tokens', usdPrice: '3.75', unitScale: 1_000_000 },
  ] },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', kind: 'text', role: 'Low-cost high-volume model', rates: [
    { metric: 'input_tokens', usdPrice: '0.30', unitScale: 1_000_000 }, { metric: 'cached_input_tokens', usdPrice: '0.03', unitScale: 1_000_000 },
    { metric: 'output_tokens', usdPrice: '2.50', unitScale: 1_000_000 }, { metric: 'thinking_tokens', usdPrice: '2.50', unitScale: 1_000_000 },
  ] },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', kind: 'text', role: 'Advanced reasoning model', pricingNote: 'Preview model with separate rates above 200,000 prompt tokens.', rates: [
    { metric: 'input_tokens', usdPrice: '2.00', unitScale: 1_000_000 }, { metric: 'cached_input_tokens', usdPrice: '0.20', unitScale: 1_000_000 },
    { metric: 'output_tokens', usdPrice: '12.00', unitScale: 1_000_000 }, { metric: 'thinking_tokens', usdPrice: '12.00', unitScale: 1_000_000 },
    { metric: 'input_tokens_over_200k', usdPrice: '4.00', unitScale: 1_000_000 }, { metric: 'cached_input_tokens_over_200k', usdPrice: '0.40', unitScale: 1_000_000 },
    { metric: 'output_tokens_over_200k', usdPrice: '18.00', unitScale: 1_000_000 }, { metric: 'thinking_tokens_over_200k', usdPrice: '18.00', unitScale: 1_000_000 },
  ] },
  { id: 'gemini-3.1-flash-image', name: 'Nano Banana 2', kind: 'image', role: 'Everyday image generation', rates: [
    { metric: 'input_tokens', usdPrice: '0.50', unitScale: 1_000_000 }, { metric: 'output_tokens', usdPrice: '3.00', unitScale: 1_000_000 },
    { metric: 'thinking_tokens', usdPrice: '3.00', unitScale: 1_000_000 }, { metric: 'output_image_tokens', usdPrice: '60.00', unitScale: 1_000_000 },
  ] },
  { id: 'gemini-3-pro-image', name: 'Nano Banana Pro', kind: 'image', role: 'Advanced image generation', rates: [
    { metric: 'input_tokens', usdPrice: '2.00', unitScale: 1_000_000 }, { metric: 'output_tokens', usdPrice: '12.00', unitScale: 1_000_000 },
    { metric: 'thinking_tokens', usdPrice: '12.00', unitScale: 1_000_000 }, { metric: 'output_image_tokens', usdPrice: '120.00', unitScale: 1_000_000 },
  ] },
  { id: 'veo-3.1-generate-preview', name: 'Veo 3.1 Standard', kind: 'video', role: 'Video generation with audio', pricingNote: '720p and 1080p standard output. 4K is not enabled.', rates: [
    { metric: 'video_second', usdPrice: '0.40', unitScale: 1 },
  ] },
] as const;

const curatedById = new Map(CURATED_AI_MODELS.map(model => [model.id, model]));

export function curatedAiModel(modelId: string): CuratedAiModel | null {
  return curatedById.get(modelId) ?? null;
}

export function isCuratedAiModel(modelId: string, kind?: AiModelKind): boolean {
  const model = curatedAiModel(modelId);
  return Boolean(model && (!kind || model.kind === kind));
}

function decimalParts(value: string): { value: bigint; scale: bigint } {
  if (!/^\d+(?:\.\d{1,8})?$/.test(value)) throw new Error('Use a positive decimal with at most eight decimal places.');
  const [whole, fraction = ''] = value.split('.');
  return { value: BigInt(`${whole}${fraction}`), scale: 10n ** BigInt(fraction.length) };
}

export function audMicrosFromUsd(usdPrice: string, audPerUsd: string): bigint {
  const usd = decimalParts(usdPrice);
  const fx = decimalParts(audPerUsd);
  if (fx.value <= 0n) throw new Error('AUD per USD must be greater than zero.');
  const denominator = usd.scale * fx.scale;
  return (usd.value * fx.value * 1_000_000n + denominator - 1n) / denominator;
}

export function hasCompleteCuratedPricing(modelId: string, metrics: Iterable<AiRateMetric>): boolean {
  const model = curatedAiModel(modelId);
  if (!model) return false;
  const present = new Set(metrics);
  return model.rates.every(rate => present.has(rate.metric));
}