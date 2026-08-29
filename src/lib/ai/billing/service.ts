import { randomUUID } from 'node:crypto';
import { AiBillingRepository, type RateRow } from './repository';
import { AiUsageDeniedError, type AiBillingContext, type AiRateMetric, type AiUsageUnits } from './types';

const EMPTY_UNITS: AiUsageUnits = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, thinkingTokens: 0, outputImages: 0, videoSeconds: 0 };

function unitsForMetric(units: AiUsageUnits, metric: AiRateMetric): number {
  return metric === 'input_tokens' ? units.inputTokens
    : metric === 'cached_input_tokens' ? units.cachedInputTokens
    : metric === 'output_tokens' ? units.outputTokens
    : metric === 'thinking_tokens' ? units.thinkingTokens
    : metric === 'output_image' ? units.outputImages : units.videoSeconds;
}

export function calculateRateCharge(units: AiUsageUnits, rates: RateRow[]): bigint {
  return rates.reduce((total, rate) => {
    const count = BigInt(unitsForMetric(units, rate.metric));
    const scale = BigInt(rate.unit_scale || 1);
    return total + (count * BigInt(rate.price_per_unit_micros) + scale - 1n) / scale;
  }, 0n);
}

export function normalizeUsageMetadata(metadata: any): AiUsageUnits {
  return {
    ...EMPTY_UNITS,
    inputTokens: Number(metadata?.promptTokenCount ?? metadata?.prompt_tokens ?? 0),
    cachedInputTokens: Number(metadata?.cachedContentTokenCount ?? metadata?.cachedContentInputTokenCount ?? 0),
    outputTokens: Number(metadata?.candidatesTokenCount ?? metadata?.output_tokens ?? 0),
    thinkingTokens: Number(metadata?.thoughtsTokenCount ?? metadata?.thinking_tokens ?? 0),
  };
}

export const AiUsageService = {
  async beginCall(context: AiBillingContext, modelId: string, estimatedUnits: AiUsageUnits = EMPTY_UNITS) {
    const accountRows = await import('@/services/MySQLService').then(({ query }) => query<any>(`SELECT plan_key FROM business_ai_accounts WHERE business_id = ?`, [context.businessId]));
    if (!accountRows[0]) throw new AiUsageDeniedError('AI account is not configured.', 'account_unavailable');
    const rates = await AiBillingRepository.getRates(accountRows[0].plan_key, modelId);
    const requiredMetrics = (Object.entries({ input_tokens: estimatedUnits.inputTokens, output_tokens: estimatedUnits.outputTokens, output_image: estimatedUnits.outputImages, video_second: estimatedUnits.videoSeconds }) as Array<[AiRateMetric, number]>).filter(([, units]) => units > 0).map(([metric]) => metric);
    const providerMetrics = new Set(rates.provider.map(rate => rate.metric));
    const planMetrics = new Set(rates.plan.map(rate => rate.metric));
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