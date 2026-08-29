import { getPool, query } from '@/services/MySQLService';
import { audToMicros, microsToAud } from './money';
import { AI_PLAN_KEYS, AI_RATE_METRICS } from './types';

export const AiRateRepository = {
  async list() {
    const [provider, plans] = await Promise.all([
      query<any>(`SELECT id,provider,model_id,metric,price_per_unit_micros,unit_scale,source_currency,source_price_decimal,aud_fx_rate,effective_from,effective_to,created_at FROM ai_provider_rates ORDER BY model_id,metric,effective_from DESC`),
      query<any>(`SELECT id,plan_key,model_id,metric,price_per_unit_micros,unit_scale,effective_from,effective_to,created_at FROM ai_plan_rates ORDER BY plan_key,model_id,metric,effective_from DESC`),
    ]);
    return {
      provider: provider.map(row => ({ ...row, priceAud: microsToAud(BigInt(row.price_per_unit_micros)), price_per_unit_micros: undefined })),
      plans: plans.map(row => ({ ...row, priceAud: microsToAud(BigInt(row.price_per_unit_micros)), price_per_unit_micros: undefined })),
    };
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