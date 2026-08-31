import { getPool, query } from '@/services/MySQLService';
import { audToMicros, microsToAud } from './money';
import { AI_PLAN_KEYS, AI_RATE_METRICS } from './types';
import type { GoogleRateCandidate } from './googlePricing';
import { ensureAiCommercialSchema } from './commercialSchema';
import { pricingCompleteness } from './modelCatalog';
import type { AiRateMetric } from './types';

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

const RATE_METRIC_DEFINITION = `ENUM('input_tokens','cached_input_tokens','output_tokens','thinking_tokens','input_tokens_over_200k','cached_input_tokens_over_200k','output_tokens_over_200k','thinking_tokens_over_200k','output_image_tokens','output_image','video_second') NOT NULL`;

async function ensureRateMetricSchema(pool: ReturnType<typeof getPool>) {
  const [columns] = await pool.execute<any[]>(`SELECT TABLE_NAME,COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('ai_provider_rates','ai_plan_rates') AND COLUMN_NAME='metric'`);
  for (const tableName of ['ai_provider_rates', 'ai_plan_rates']) {
    const column = columns.find(row => row.TABLE_NAME === tableName);
    if (!String(column?.COLUMN_TYPE || '').includes('output_image_tokens')) await pool.execute(`ALTER TABLE ${tableName} MODIFY metric ${RATE_METRIC_DEFINITION}`);
  }
}

export const AiRateRepository = {
  async list() {
    await ensureAiCommercialSchema();
    const [provider, plans, planSettings, models] = await Promise.all([
      query<any>(`SELECT id,provider,model_id,metric,price_per_unit_micros,unit_scale,source_currency,source_price_decimal,aud_fx_rate,source_sku_id,source_price_name,effective_from,effective_to,created_at FROM ai_provider_rates ORDER BY model_id,metric,effective_from DESC`),
      query<any>(`SELECT id,plan_key,model_id,metric,price_per_unit_micros,unit_scale,effective_from,effective_to,created_at FROM ai_plan_rates ORDER BY plan_key,model_id,metric,effective_from DESC`),
      query<any>(`SELECT plan_key,pricing_mode,markup_basis_points FROM ai_plans WHERE is_active=1 ORDER BY plan_key`),
      query<any>(`SELECT m.model_id,m.is_allowed,COUNT(r.id) AS active_rate_count FROM ai_provider_models m JOIN ai_provider_rates r ON r.provider=m.provider AND r.model_id=m.model_id AND r.effective_from<=NOW(3) AND (r.effective_to IS NULL OR r.effective_to>NOW(3)) WHERE m.provider='google' GROUP BY m.model_id,m.is_allowed ORDER BY m.model_id`),
    ]);
    return {
      provider: provider.map(row => ({ ...row, priceAud: microsToAud(BigInt(row.price_per_unit_micros)), price_per_unit_micros: undefined })),
      plans: plans.map(row => ({ ...row, priceAud: microsToAud(BigInt(row.price_per_unit_micros)), price_per_unit_micros: undefined })),
      planSettings: planSettings.map(row => ({ planKey: row.plan_key, pricingMode: row.pricing_mode, markupPercent: (Number(row.markup_basis_points) / 100).toFixed(2).replace(/\.00$/, '') })),
      models: models.map(row => ({ modelId: row.model_id, allowed: Boolean(row.is_allowed), activeRateCount: Number(row.active_rate_count) })),
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
    const pool = getPool();
    await ensureRateMetricSchema(pool);
    await ensureAiCommercialSchema();
    const connection = await pool.getConnection();
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
        await connection.execute(`INSERT IGNORE INTO ai_provider_models (provider,model_id,is_allowed) VALUES ('google',?,0)`, [candidate.modelId]);
        imported++;
      }
      await connection.commit();
      return { imported, skipped };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  },

  async savePlanPricing(settings: Record<string, { pricingMode?: unknown; markupPercent?: unknown }>) {
    const parsed = Object.entries(settings || {}).map(([planKey, value]) => {
      if (!AI_PLAN_KEYS.includes(planKey as (typeof AI_PLAN_KEYS)[number])) throw new Error('Invalid plan.');
      const pricingMode = value?.pricingMode === 'rates' ? 'rates' : value?.pricingMode === 'markup' ? 'markup' : null;
      if (!pricingMode) throw new Error('Choose sell rates or flat markup for every changed plan.');
      const basisPoints = parseMarkupBasisPoints(value?.markupPercent ?? '0');
      return { planKey, pricingMode, basisPoints };
    });
    if (!parsed.length) throw new Error('Choose at least one plan pricing change.');
    await ensureAiCommercialSchema();
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      for (const { planKey, pricingMode, basisPoints } of parsed) await connection.execute(`UPDATE ai_plans SET pricing_mode=?,markup_basis_points=? WHERE plan_key=?`, [pricingMode, Number(basisPoints), planKey]);
      await connection.commit();
      return { plans: parsed.length };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  },

  async setModelAllowed(modelId: string, allowed: boolean) {
    await ensureAiCommercialSchema();
    const [modelRows, rates] = await Promise.all([
      query<any>(`SELECT * FROM ai_discovered_models WHERE provider='google' AND model_id=? AND lifecycle_status<>'retired' LIMIT 1`, [modelId]),
      query<any>(`SELECT metric FROM ai_provider_rates WHERE provider='google' AND model_id=? AND effective_from<=NOW(3) AND (effective_to IS NULL OR effective_to>NOW(3))`, [modelId]),
    ]);
    if (!modelRows.length) throw new Error('Only currently discovered Google models can be allowed.');
    const row = modelRows[0];
    const model = { provider: 'google' as const, modelId: row.model_id, displayName: row.display_name, version: row.model_version, supportedGenerationMethods: JSON.parse(row.supported_generation_methods || '[]'), inputModalities: JSON.parse(row.input_modalities || '[]'), outputModalities: JSON.parse(row.output_modalities || '[]'), inputTokenLimit: row.input_token_limit == null ? null : Number(row.input_token_limit), outputTokenLimit: row.output_token_limit == null ? null : Number(row.output_token_limit), lifecycleStatus: row.lifecycle_status };
    const completeness = pricingCompleteness(model, rates.map(rate => rate.metric as AiRateMetric));
    if (allowed && !completeness.complete) throw new Error(`Model pricing is incomplete: missing ${completeness.missingMetrics.join(', ')}.`);
    await getPool().execute(`INSERT INTO ai_provider_models (provider,model_id,is_allowed) VALUES ('google',?,?) ON DUPLICATE KEY UPDATE is_allowed=VALUES(is_allowed)`, [modelId, allowed ? 1 : 0]);
    return true;
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
        await connection.execute(`INSERT IGNORE INTO ai_provider_models (provider,model_id,is_allowed) VALUES ('google',?,0)`, [input.modelId]);
      } else {
        await connection.execute(`INSERT INTO ai_plan_rates (plan_key,model_id,metric,price_per_unit_micros,unit_scale,effective_from,created_by) VALUES (?,?,?,?,?,?,?)`, [input.planKey, input.modelId, input.metric, price.toString(), Number(input.unitScale || 1_000_000), effectiveFrom, actorUserId]);
      }
      await connection.commit(); return true;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },
};