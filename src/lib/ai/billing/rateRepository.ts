import { getPool, query } from '@/services/MySQLService';
import { audToMicros, microsToAud } from './money';
import { AI_PLAN_KEYS, AI_RATE_METRICS } from './types';
import type { GoogleRateCandidate } from './googlePricing';

export function parseMarkupBasisPoints(value: unknown): bigint {
  const normalized = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Markup must be a non-negative percentage with at most two decimal places.');
  const [whole, fraction = ''] = normalized.split('.');
  const basisPoints = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (basisPoints > 100_000n) throw new Error('Markup cannot exceed 1,000%.');
  return basisPoints;
}

export function applyMarkup(providerPriceMicros: bigint, markupBasisPoints: bigint): bigint {
  return (providerPriceMicros * (10_000n + markupBasisPoints) + 9_999n) / 10_000n;
}

export const AiRateRepository = {
  async list() {
    const [provider, plans] = await Promise.all([
      query<any>(`SELECT id,provider,model_id,metric,price_per_unit_micros,unit_scale,source_currency,source_price_decimal,aud_fx_rate,source_sku_id,source_price_name,effective_from,effective_to,created_at FROM ai_provider_rates ORDER BY model_id,metric,effective_from DESC`),
      query<any>(`SELECT id,plan_key,model_id,metric,price_per_unit_micros,unit_scale,effective_from,effective_to,created_at FROM ai_plan_rates ORDER BY plan_key,model_id,metric,effective_from DESC`),
    ]);
    return {
      provider: provider.map(row => ({ ...row, priceAud: microsToAud(BigInt(row.price_per_unit_micros)), price_per_unit_micros: undefined })),
      plans: plans.map(row => ({ ...row, priceAud: microsToAud(BigInt(row.price_per_unit_micros)), price_per_unit_micros: undefined })),
    };
  },

  async compareGoogle(candidates: GoogleRateCandidate[]) {
    const active = await query<any>(`SELECT model_id,metric,price_per_unit_micros,unit_scale FROM ai_provider_rates WHERE provider='google' AND effective_to IS NULL`);
    const current = new Map(active.map(row => [`${row.model_id}:${row.metric}`, row]));
    return candidates.map(candidate => {
      const row = current.get(`${candidate.modelId}:${candidate.metric}`);
      const currentPriceAud = row ? microsToAud(BigInt(row.price_per_unit_micros)) : null;
      const unchanged = !!row && currentPriceAud === candidate.priceAud && Number(row.unit_scale) === candidate.unitScale;
      return { ...candidate, currentPriceAud, status: unchanged ? 'unchanged' : row ? 'changed' : 'new' };
    });
  },

  async importGoogle(candidates: GoogleRateCandidate[], actorUserId: number) {
    const rateKeys = candidates.map(candidate => `${candidate.modelId}:${candidate.metric}`);
    if (new Set(rateKeys).size !== rateKeys.length) throw new Error('Google rate selection contains duplicate model metrics. Refresh and review the preview.');
    const connection = await getPool().getConnection();
    let imported = 0; let skipped = 0;
    try {
      await connection.beginTransaction();
      const effectiveFrom = new Date();
      for (const candidate of candidates) {
        const [rows] = await connection.execute<any[]>(`SELECT price_per_unit_micros,unit_scale FROM ai_provider_rates WHERE provider='google' AND model_id=? AND metric=? AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`, [candidate.modelId, candidate.metric]);
        const price = audToMicros(candidate.priceAud);
        if (rows[0] && BigInt(rows[0].price_per_unit_micros) === price && Number(rows[0].unit_scale) === candidate.unitScale) { skipped++; continue; }
        await connection.execute(`UPDATE ai_provider_rates SET effective_to=? WHERE provider='google' AND model_id=? AND metric=? AND effective_from < ? AND effective_to IS NULL`, [effectiveFrom, candidate.modelId, candidate.metric, effectiveFrom]);
        await connection.execute(`INSERT INTO ai_provider_rates (provider,model_id,metric,price_per_unit_micros,unit_scale,source_currency,source_price_decimal,aud_fx_rate,source_sku_id,source_price_name,effective_from,created_by) VALUES ('google',?,?,?,?,?,?,?,?,?,?,?)`, [candidate.modelId, candidate.metric, price.toString(), candidate.unitScale, candidate.sourceCurrency, candidate.sourcePriceDecimal, candidate.audFxRate, candidate.skuId, candidate.priceName, effectiveFrom, actorUserId]);
        imported++;
      }
      await connection.commit();
      return { imported, skipped };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  },

  async applyPlanMarkups(markups: Partial<Record<(typeof AI_PLAN_KEYS)[number], unknown>>, actorUserId: number) {
    const selected = Object.entries(markups || {}).filter(([, value]) => String(value ?? '').trim() !== '');
    if (!selected.length) throw new Error('Enter a markup for at least one plan.');
    const parsed = selected.map(([planKey, value]) => {
      if (!AI_PLAN_KEYS.includes(planKey as (typeof AI_PLAN_KEYS)[number])) throw new Error('Invalid plan.');
      return { planKey, basisPoints: parseMarkupBasisPoints(value) };
    });
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [providerRates] = await connection.execute<any[]>(`SELECT model_id,metric,price_per_unit_micros,unit_scale FROM ai_provider_rates WHERE provider='google' AND effective_to IS NULL ORDER BY model_id,metric FOR UPDATE`);
      if (!providerRates.length) throw new Error('No active provider rates are available.');
      const effectiveFrom = new Date();
      let created = 0;
      for (const { planKey, basisPoints } of parsed) {
        for (const providerRate of providerRates) {
          const price = applyMarkup(BigInt(providerRate.price_per_unit_micros), basisPoints);
          await connection.execute(`UPDATE ai_plan_rates SET effective_to=? WHERE plan_key=? AND model_id=? AND metric=? AND effective_from < ? AND effective_to IS NULL`, [effectiveFrom, planKey, providerRate.model_id, providerRate.metric, effectiveFrom]);
          await connection.execute(`INSERT INTO ai_plan_rates (plan_key,model_id,metric,price_per_unit_micros,unit_scale,effective_from,created_by) VALUES (?,?,?,?,?,?,?)`, [planKey, providerRate.model_id, providerRate.metric, price.toString(), Number(providerRate.unit_scale), effectiveFrom, actorUserId]);
          created++;
        }
      }
      await connection.commit();
      return { plans: parsed.length, rates: created, providerRates: providerRates.length };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  },

  async add(input: any, actorUserId: number) {
    if (!AI_RATE_METRICS.includes(input.metric)) throw new Error('Invalid rate metric.');
    if (!String(input.modelId || '').trim()) throw new Error('Model ID is required.');
    const price = audToMicros(input.priceAud);
    if (price < 0n) throw new Error('Rate cannot be negative.');
    const effectiveFrom = new Date(input.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) throw new Error('A valid effective date is required.');
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const table = input.kind === 'provider' ? 'ai_provider_rates' : 'ai_plan_rates';
      if (table === 'ai_plan_rates' && !AI_PLAN_KEYS.includes(input.planKey)) throw new Error('Invalid plan.');
      const scopeSql = table === 'ai_provider_rates' ? `provider='google'` : 'plan_key=?';
      const scopeParams = table === 'ai_provider_rates' ? [] : [input.planKey];
      await connection.execute(`UPDATE ${table} SET effective_to=? WHERE ${scopeSql} AND model_id=? AND metric=? AND effective_from < ? AND (effective_to IS NULL OR effective_to > ?)`, [...scopeParams, effectiveFrom, input.modelId, input.metric, effectiveFrom, effectiveFrom]);
      if (table === 'ai_provider_rates') {
        await connection.execute(`INSERT INTO ai_provider_rates (provider,model_id,metric,price_per_unit_micros,unit_scale,source_currency,source_price_decimal,aud_fx_rate,effective_from,created_by) VALUES ('google',?,?,?,?,?,?,?,?,?)`, [input.modelId, input.metric, price.toString(), Number(input.unitScale || 1_000_000), input.sourceCurrency || 'USD', input.sourcePriceDecimal, input.audFxRate, effectiveFrom, actorUserId]);
      } else {
        await connection.execute(`INSERT INTO ai_plan_rates (plan_key,model_id,metric,price_per_unit_micros,unit_scale,effective_from,created_by) VALUES (?,?,?,?,?,?,?)`, [input.planKey, input.modelId, input.metric, price.toString(), Number(input.unitScale || 1_000_000), effectiveFrom, actorUserId]);
      }
      await connection.commit(); return true;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },
};