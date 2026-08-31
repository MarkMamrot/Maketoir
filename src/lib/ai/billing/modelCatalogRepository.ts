import { getPool, query } from '@/services/MySQLService';
import { ensureAiCommercialSchema } from './commercialSchema';
import { DEFAULT_BILLING_FAMILY_MAPPINGS, modelCapability, pricingCompleteness } from './modelCatalog';
import type { AiRateMetric } from './types';
import type { BillingFamilyMapping, CanonicalAiModel } from './modelCatalog';
import type { GoogleSkuObservation } from './googlePricing';

const parseJsonArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
};

function rowToModel(row: any): CanonicalAiModel {
  return {
    provider: 'google', modelId: row.model_id, displayName: row.display_name, version: row.model_version,
    supportedGenerationMethods: parseJsonArray(row.supported_generation_methods), inputModalities: parseJsonArray(row.input_modalities), outputModalities: parseJsonArray(row.output_modalities),
    inputTokenLimit: row.input_token_limit == null ? null : Number(row.input_token_limit), outputTokenLimit: row.output_token_limit == null ? null : Number(row.output_token_limit), lifecycleStatus: row.lifecycle_status,
  };
}

export async function ensureDefaultBillingMappings() {
  await ensureAiCommercialSchema();
  for (const mapping of DEFAULT_BILLING_FAMILY_MAPPINGS) {
    await getPool().execute(`INSERT IGNORE INTO ai_billing_family_mappings (provider,model_id,family_pattern,match_type,mapping_version,is_active) VALUES (?,?,?,?,?,1)`, [mapping.provider, mapping.modelId, mapping.familyPattern, mapping.matchType, mapping.mappingVersion]);
  }
}

export const AiModelCatalogRepository = {
  async discover(models: CanonicalAiModel[]) {
    if (!models.length) throw new Error('Discovery returned no models; existing catalog was retained.');
    await ensureDefaultBillingMappings();
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const seen = models.map(model => model.modelId);
      for (const model of models) await connection.execute(`INSERT INTO ai_discovered_models (provider,model_id,display_name,model_version,supported_generation_methods,input_modalities,output_modalities,input_token_limit,output_token_limit,lifecycle_status,last_seen_at,retired_at,raw_metadata) VALUES ('google',?,?,?,?,?,?,?,?,?,NOW(3),NULL,?) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),model_version=VALUES(model_version),supported_generation_methods=VALUES(supported_generation_methods),input_modalities=VALUES(input_modalities),output_modalities=VALUES(output_modalities),input_token_limit=VALUES(input_token_limit),output_token_limit=VALUES(output_token_limit),lifecycle_status=VALUES(lifecycle_status),last_seen_at=NOW(3),retired_at=NULL,raw_metadata=VALUES(raw_metadata)`, [model.modelId, model.displayName, model.version, JSON.stringify(model.supportedGenerationMethods), JSON.stringify(model.inputModalities), JSON.stringify(model.outputModalities), model.inputTokenLimit, model.outputTokenLimit, model.lifecycleStatus, JSON.stringify(model)]);
      const placeholders = seen.map(() => '?').join(',');
      await connection.execute(`UPDATE ai_discovered_models SET lifecycle_status='retired',retired_at=COALESCE(retired_at,NOW(3)) WHERE provider='google' AND model_id NOT IN (${placeholders})`, seen);
      await connection.commit();
      return { discovered: models.length };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  },

  async mappings(): Promise<BillingFamilyMapping[]> {
    await ensureDefaultBillingMappings();
    const rows = await query<any>(`SELECT m.id,m.provider,m.model_id,m.family_pattern,m.match_type,m.mapping_version,m.is_active FROM ai_billing_family_mappings m JOIN ai_discovered_models d ON d.provider=m.provider AND d.model_id=m.model_id AND d.lifecycle_status<>'retired' WHERE m.provider='google' ORDER BY m.model_id,m.mapping_version DESC,m.id`);
    return rows.map(row => ({ id: Number(row.id), provider: 'google', modelId: row.model_id, familyPattern: row.family_pattern, matchType: row.match_type, mappingVersion: Number(row.mapping_version), isActive: Boolean(row.is_active) }));
  },

  async saveMapping(input: { modelId: string; familyPattern: string; matchType: 'contains' | 'regex' }, actorUserId: number) {
    await ensureDefaultBillingMappings();
    if (!input.modelId.trim() || !input.familyPattern.trim()) throw new Error('Model and billing family pattern are required.');
    if (!['contains', 'regex'].includes(input.matchType)) throw new Error('Invalid mapping match type.');
    if (input.matchType === 'regex') { try { new RegExp(input.familyPattern); } catch { throw new Error('Billing family regular expression is invalid.'); } }
    const model = await query<any>(`SELECT 1 FROM ai_discovered_models WHERE provider='google' AND model_id=? AND lifecycle_status<>'retired' LIMIT 1`, [input.modelId]);
    if (!model.length) throw new Error('Choose a currently discovered Google model.');
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [versions] = await connection.execute<any[]>(`SELECT COALESCE(MAX(mapping_version),0)+1 AS next_version FROM ai_billing_family_mappings WHERE provider='google' AND model_id=? FOR UPDATE`, [input.modelId]);
      const version = Number(versions[0].next_version);
      const [result] = await connection.execute<any>(`INSERT INTO ai_billing_family_mappings (provider,model_id,family_pattern,match_type,mapping_version,is_active,created_by) VALUES ('google',?,?,?,?,1,?)`, [input.modelId, input.familyPattern, input.matchType, version, actorUserId]);
      const after = { modelId: input.modelId, familyPattern: input.familyPattern, matchType: input.matchType, mappingVersion: version, isActive: true };
      await connection.execute(`INSERT INTO ai_billing_mapping_audit (mapping_id,action,after_json,actor_user_id) VALUES (?,'create',?,?)`, [result.insertId, JSON.stringify(after), actorUserId]);
      await connection.commit();
      return { id: Number(result.insertId), ...after };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  },

  async deactivateMapping(mappingId: number, actorUserId: number) {
    await ensureDefaultBillingMappings();
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<any[]>(`SELECT * FROM ai_billing_family_mappings WHERE id=? FOR UPDATE`, [mappingId]);
      if (!rows.length) throw new Error('Billing mapping was not found.');
      await connection.execute(`UPDATE ai_billing_family_mappings SET is_active=0 WHERE id=?`, [mappingId]);
      await connection.execute(`INSERT INTO ai_billing_mapping_audit (mapping_id,action,before_json,after_json,actor_user_id) VALUES (?,'deactivate',?,?,?)`, [mappingId, JSON.stringify(rows[0]), JSON.stringify({ ...rows[0], is_active: 0 }), actorUserId]);
      await connection.commit();
      return true;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  },

  async recordObservations(observations: GoogleSkuObservation[]) {
    await ensureDefaultBillingMappings();
    for (const observation of observations) await getPool().execute(`INSERT INTO ai_provider_sku_observations (provider,sku_id,sku_name,price_name,mapped_model_id,reconciliation_status,reason,last_seen_at) VALUES ('google',?,?,?,?,?,?,NOW(3)) ON DUPLICATE KEY UPDATE sku_name=VALUES(sku_name),price_name=VALUES(price_name),mapped_model_id=VALUES(mapped_model_id),reconciliation_status=VALUES(reconciliation_status),reason=VALUES(reason),last_seen_at=NOW(3)`, [observation.skuId, observation.skuName, observation.priceName || null, observation.mappedModelId, observation.status, observation.reason]);
    return { observed: observations.length };
  },

  async list() {
    await ensureDefaultBillingMappings();
    const [models, rates, observations, mappings] = await Promise.all([
      query<any>(`SELECT * FROM ai_discovered_models WHERE provider='google' ORDER BY lifecycle_status,display_name`),
      query<any>(`SELECT model_id,metric FROM ai_provider_rates WHERE provider='google' AND effective_from<=NOW(3) AND (effective_to IS NULL OR effective_to>NOW(3))`),
      query<any>(`SELECT provider,sku_id,sku_name,price_name,mapped_model_id,reconciliation_status,reason,last_seen_at FROM ai_provider_sku_observations WHERE provider='google' AND reconciliation_status<>'mapped' ORDER BY last_seen_at DESC,sku_name`),
      this.mappings(),
    ]);
    const metrics = Map.groupBy(rates, row => String(row.model_id));
    const catalog = models.map(row => {
      const model = rowToModel(row);
      const completeness = pricingCompleteness(model, (metrics.get(model.modelId) || []).map(rate => rate.metric as AiRateMetric));
      return { ...model, capability: modelCapability(model), ...completeness, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, retiredAt: row.retired_at };
    });
    return { models: catalog, mappings, queue: [...observations, ...catalog.filter(model => model.lifecycleStatus !== 'retired' && !model.complete).map(model => ({ sku_id: null, sku_name: null, mapped_model_id: model.modelId, reconciliation_status: model.capability ? 'incomplete_pricing' : 'unknown_metric', reason: model.capability ? `Missing ${model.missingMetrics.join(', ')}` : 'This model does not match a Solvantis text, image, or video billing capability.' }))] };
  },
};