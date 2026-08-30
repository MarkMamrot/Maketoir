import { randomUUID } from 'node:crypto';
import { AiBillingRepository, type RateRow } from './repository';
import { AiUsageDeniedError, type AiBillingContext, type AiRateMetric, type AiUsageUnits } from './types';
import { isModelAllowedForPlan } from './commercialModels';

const EMPTY_UNITS: AiUsageUnits = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, thinkingTokens: 0, outputImageTokens: 0, outputImages: 0, videoSeconds: 0 };

function unitsForMetric(units: AiUsageUnits, metric: AiRateMetric): number {
  const longContextMetric = metric.endsWith('_over_200k');
  if (longContextMetric && units.inputTokens + units.cachedInputTokens <= 200_000) return 0;
  return metric === 'input_tokens' || metric === 'input_tokens_over_200k' ? units.inputTokens
    : metric === 'cached_input_tokens' || metric === 'cached_input_tokens_over_200k' ? units.cachedInputTokens
    : metric === 'output_tokens' || metric === 'output_tokens_over_200k' ? units.outputTokens
    : metric === 'thinking_tokens' || metric === 'thinking_tokens_over_200k' ? units.thinkingTokens
    : metric === 'output_image_tokens' ? units.outputImageTokens
    : metric === 'output_image' ? units.outputImages : units.videoSeconds;
}

export function calculateRateCharge(units: AiUsageUnits, rates: RateRow[]): bigint {
  const longContext = units.inputTokens + units.cachedInputTokens > 200_000;
  const availableMetrics = new Set(rates.map(rate => rate.metric));
  return rates.reduce((total, rate) => {
    if (longContext && ['input_tokens', 'cached_input_tokens', 'output_tokens', 'thinking_tokens'].includes(rate.metric) && availableMetrics.has(`${rate.metric}_over_200k` as AiRateMetric)) return total;
    const count = BigInt(unitsForMetric(units, rate.metric));
    const scale = BigInt(rate.unit_scale || 1);
    return total + (count * BigInt(rate.price_per_unit_micros) + scale - 1n) / scale;
  }, 0n);
}

export function normalizeUsageMetadata(metadata: any): AiUsageUnits {
  const promptTokens = Number(metadata?.promptTokenCount ?? metadata?.prompt_tokens ?? 0);
  const cachedInputTokens = Number(metadata?.cachedContentTokenCount ?? metadata?.cachedContentInputTokenCount ?? 0);
  const outputDetails = Array.isArray(metadata?.candidatesTokensDetails) ? metadata.candidatesTokensDetails : [];
  const outputImageTokens = outputDetails.reduce((total: number, detail: any) => String(detail?.modality || '').toUpperCase() === 'IMAGE' ? total + Number(detail?.tokenCount || 0) : total, 0);
  const candidateTokens = Number(metadata?.candidatesTokenCount ?? metadata?.output_tokens ?? 0);
  return {
    ...EMPTY_UNITS,
    inputTokens: Math.max(0, promptTokens - cachedInputTokens),
    cachedInputTokens,
    outputTokens: Math.max(0, candidateTokens - outputImageTokens),
    thinkingTokens: Number(metadata?.thoughtsTokenCount ?? metadata?.thinking_tokens ?? 0),
    outputImageTokens,
  };
}

export const AiUsageService = {
  async beginCall(context: AiBillingContext, modelId: string, estimatedUnits: AiUsageUnits = EMPTY_UNITS) {
    const accountRows = await import('@/services/MySQLService').then(({ query }) => query<any>(`SELECT plan_key FROM business_ai_accounts WHERE business_id = ?`, [context.businessId]));
    if (!accountRows[0]) throw new AiUsageDeniedError('AI account is not configured.', 'account_unavailable');
    if (!await isModelAllowedForPlan(accountRows[0].plan_key, modelId)) throw new AiUsageDeniedError('This AI model is not available on the current plan.', 'model_not_allowed');
    const rates = await AiBillingRepository.getRates(accountRows[0].plan_key, modelId);
    const providerMetrics = new Set(rates.provider.map(rate => rate.metric));
    const planMetrics = new Set(rates.plan.map(rate => rate.metric));
    const hasLongContextPricing = [...providerMetrics, ...planMetrics].some(metric => metric.endsWith('_over_200k'));
    const longContext = estimatedUnits.inputTokens + estimatedUnits.cachedInputTokens > 200_000;
    const requiredMetrics = (Object.entries({ input_tokens: estimatedUnits.inputTokens, output_tokens: estimatedUnits.outputTokens, output_image_tokens: estimatedUnits.outputImageTokens, output_image: estimatedUnits.outputImages, video_second: estimatedUnits.videoSeconds }) as Array<[AiRateMetric, number]>)
      .filter(([, units]) => units > 0)
      .map(([metric]) => longContext && hasLongContextPricing && ['input_tokens', 'output_tokens'].includes(metric) ? `${metric}_over_200k` as AiRateMetric : metric);
    if (requiredMetrics.some(metric => !providerMetrics.has(metric) || !planMetrics.has(metric))) {
      const account = await import('@/services/MySQLService').then(({ query }) => query<any>(`SELECT enforcement_mode FROM business_ai_accounts WHERE business_id = ?`, [context.businessId]));
      if (account[0]?.enforcement_mode === 'enforce') throw new AiUsageDeniedError('AI pricing is not configured for this model.', 'pricing_unavailable');
    }
    const reservedMicros = calculateRateCharge(estimatedUnits, rates.plan);
    try {
      const reservation = await AiBillingRepository.reserve({ ...context, callKey: randomUUID(), modelId, reservedMicros, rateSnapshot: rates.plan });
      return { ...reservation, modelId, rates };
    } catch (error: any) {
      const reason = error?.reason;
      if (reason) throw new AiUsageDeniedError(error.message, reason);
      throw error;
    }
  },

  async settleCall(reservation: Awaited<ReturnType<typeof AiUsageService.beginCall>>, units: AiUsageUnits) {
    await AiBillingRepository.settle({
      callId: reservation.callId,
      units,
      providerCostMicros: calculateRateCharge(units, reservation.rates.provider),
      tenantChargeMicros: calculateRateCharge(units, reservation.rates.plan),
      providerRates: reservation.rates.provider,
      planRates: reservation.rates.plan,
    });
  },
};