import { getPool, query } from '@/services/MySQLService';

import { AI_PLAN_KEYS } from './types';
import { CURATED_AI_MODELS, audMicrosFromUsd } from './curatedModels';
import { ensureAiCommercialSchema } from './commercialSchema';
import { microsToAud } from './money';
import { parseMarkupBasisPoints } from './rateRepository';

const FX_SETTING = 'aud_per_usd';

export function parseAudPerUsd(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(normalized) || Number(normalized) <= 0 || Number(normalized) > 10) {
    throw new Error('AUD per USD must be greater than zero and no more than 10, with up to eight decimal places.');
  }
  return normalized;
}

function parsedMarkups(markups: Record<string, unknown>) {
  return AI_PLAN_KEYS.map(planKey => {
    if (!(planKey in markups)) throw new Error(`Enter a markup for ${planKey}.`);
    return { planKey, basisPoints: parseMarkupBasisPoints(markups[planKey]) };
  });
}

export const CuratedPricingRepository = {
  async get() {
    await ensureAiCommercialSchema();
    const [settings, plans, rates, allowed] = await Promise.all([
      query<any>(`SELECT decimal_value,updated_at FROM ai_billing_settings WHERE setting_key=?`, [FX_SETTING]),
      query<any>(`SELECT plan_key,markup_basis_points FROM ai_plans WHERE is_active=1 ORDER BY plan_key`),
      query<any>(`SELECT model_id,metric,price_per_unit_micros,unit_scale,aud_fx_rate FROM ai_provider_rates WHERE provider='google' AND effective_from<=NOW(3) AND (effective_to IS NULL OR effective_to>NOW(3))`),
      query<any>(`SELECT model_id,is_allowed FROM ai_provider_models WHERE provider='google'`),
    ]);
    const audPerUsd = String(settings[0]?.decimal_value || rates.find(rate => rate.aud_fx_rate)?.aud_fx_rate || '1.50');
    const activeByModel = new Map<string, any[]>();
    for (const rate of rates) activeByModel.set(rate.model_id, [...(activeByModel.get(rate.model_id) || []), rate]);
    const allowedByModel = new Map(allowed.map(row => [String(row.model_id), Boolean(row.is_allowed)]));
    const models = CURATED_AI_MODELS.map(model => {
      const current = activeByModel.get(model.id) || [];
      const expected = model.rates.map(rate => ({ ...rate, audPrice: microsToAud(audMicrosFromUsd(rate.usdPrice, audPerUsd)) }));
      const currentByMetric = new Map(current.map(rate => [String(rate.metric), rate]));
      const currentMatches = current.length === expected.length && expected.every(rate => {
        const row = currentByMetric.get(rate.metric);
        return row && String(row.price_per_unit_micros) === audMicrosFromUsd(rate.usdPrice, audPerUsd).toString() && Number(row.unit_scale) === rate.unitScale;
      });
      return { ...model, allowed: allowedByModel.get(model.id) === true, currentMatches, expected };
    });
    return {
      audPerUsd,
      fxUpdatedAt: settings[0]?.updated_at ?? null,
      markups: Object.fromEntries(plans.map(row => [row.plan_key, (Number(row.markup_basis_points) / 100).toFixed(2).replace(/\.00$/, '')])),
      models,
      current: models.every(model => model.allowed && model.currentMatches),
    };
  },

  async save(input: { audPerUsd?: unknown; markups?: Record<string, unknown> }, actorUserId: number) {
    const audPerUsd = parseAudPerUsd(input.audPerUsd);
    const markups = parsedMarkups(input.markups || {});
    await ensureAiCommercialSchema();
    const connection = await getPool().getConnection();
    const effectiveFrom = new Date();
    let updatedModels = 0;
    try {
      await connection.beginTransaction();
      await connection.execute(`INSERT INTO ai_billing_settings (setting_key,decimal_value,updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE decimal_value=VALUES(decimal_value),updated_by=VALUES(updated_by)`, [FX_SETTING, audPerUsd, actorUserId]);
      for (const model of CURATED_AI_MODELS) {
        const [current] = await connection.execute<any[]>(`SELECT metric,price_per_unit_micros,unit_scale FROM ai_provider_rates WHERE provider='google' AND model_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?) FOR UPDATE`, [model.id, effectiveFrom, effectiveFrom]);
        const expected = model.rates.map(rate => ({ ...rate, audMicros: audMicrosFromUsd(rate.usdPrice, audPerUsd) }));
        const currentByMetric = new Map(current.map(rate => [String(rate.metric), rate]));
        const unchanged = current.length === expected.length && expected.every(rate => {
          const row = currentByMetric.get(rate.metric);
          return row && String(row.price_per_unit_micros) === rate.audMicros.toString() && Number(row.unit_scale) === rate.unitScale;
        });
        if (!unchanged) {
          await connection.execute(`UPDATE ai_provider_rates SET effective_to=? WHERE provider='google' AND model_id=? AND effective_from<? AND (effective_to IS NULL OR effective_to>?)`, [effectiveFrom, model.id, effectiveFrom, effectiveFrom]);
          for (const rate of expected) await connection.execute(`INSERT INTO ai_provider_rates (provider,model_id,metric,price_per_unit_micros,unit_scale,source_currency,source_price_decimal,aud_fx_rate,source_price_name,effective_from,created_by) VALUES ('google',?,?,?,?,'USD',?,?,?, ?,?)`, [model.id, rate.metric, rate.audMicros.toString(), rate.unitScale, rate.usdPrice, audPerUsd, 'Published Gemini API pricing', effectiveFrom, actorUserId]);
          updatedModels++;
        }
      }
      await connection.execute(`UPDATE ai_provider_models SET is_allowed=0 WHERE provider='google'`);
      for (const model of CURATED_AI_MODELS) await connection.execute(`INSERT INTO ai_provider_models (provider,model_id,is_allowed) VALUES ('google',?,1) ON DUPLICATE KEY UPDATE is_allowed=1`, [model.id]);
      for (const markup of markups) await connection.execute(`UPDATE ai_plans SET pricing_mode='markup',markup_basis_points=? WHERE plan_key=?`, [Number(markup.basisPoints), markup.planKey]);
      await connection.commit();
      return { models: CURATED_AI_MODELS.length, updatedModels, plans: markups.length };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};