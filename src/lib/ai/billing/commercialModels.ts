import { query } from '@/services/MySQLService';
import { ensureAiCommercialSchema } from './commercialSchema';

export type AiModelKind = 'text' | 'image' | 'video';

export function classifyAiModel(modelId: string): AiModelKind {
  if (/^veo-|video|omni/i.test(modelId)) return 'video';
  if (/image/i.test(modelId)) return 'image';
  return 'text';
}

import { pricingCompleteness } from './modelCatalog';
import type { AiRateMetric } from './types';
import type { CanonicalAiModel } from './modelCatalog';
export function displayAiModelName(modelId: string): string {
  return modelId.split('-').map(part => /^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}


const jsonArray = (value: unknown): string[] => {
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
};

function canonicalModel(row: any): CanonicalAiModel {
  return { provider: 'google', modelId: row.model_id, displayName: row.display_name, version: row.model_version, supportedGenerationMethods: jsonArray(row.supported_generation_methods), inputModalities: jsonArray(row.input_modalities), outputModalities: jsonArray(row.output_modalities), inputTokenLimit: row.input_token_limit == null ? null : Number(row.input_token_limit), outputTokenLimit: row.output_token_limit == null ? null : Number(row.output_token_limit), lifecycleStatus: row.lifecycle_status };
}

const completeRow = (row: any) => pricingCompleteness(canonicalModel(row), String(row.active_metrics || '').split(',').filter(Boolean) as AiRateMetric[]).complete;
export async function listAllowedModelsForBusiness(businessId: string, kind: AiModelKind) {
  await ensureAiCommercialSchema();
  const rows = await query<any>(`SELECT d.model_id,d.display_name,d.model_version,d.supported_generation_methods,d.input_modalities,d.output_modalities,d.input_token_limit,d.output_token_limit,d.lifecycle_status,GROUP_CONCAT(DISTINCT r.metric) AS active_metrics
    FROM ai_provider_rates r
    JOIN ai_discovered_models d ON d.provider=r.provider AND d.model_id=r.model_id AND d.lifecycle_status<>'retired'
    JOIN ai_provider_models m ON m.provider=r.provider AND m.model_id=r.model_id AND m.is_allowed=1
    JOIN business_ai_accounts a ON a.business_id=?
    JOIN ai_plans p ON p.plan_key=a.plan_key
    WHERE r.provider='google' AND r.effective_from<=NOW(3) AND (r.effective_to IS NULL OR r.effective_to>NOW(3))
      AND (p.pricing_mode='markup' OR EXISTS (
        SELECT 1 FROM ai_plan_rates pr WHERE pr.plan_key=p.plan_key AND pr.model_id=r.model_id
          AND pr.effective_from<=NOW(3) AND (pr.effective_to IS NULL OR pr.effective_to>NOW(3))
      ))
    GROUP BY d.model_id,d.display_name,d.model_version,d.supported_generation_methods,d.input_modalities,d.output_modalities,d.input_token_limit,d.output_token_limit,d.lifecycle_status
    ORDER BY d.model_id`, [businessId]);
  return rows.filter(completeRow).map(row => String(row.model_id)).filter(modelId => classifyAiModel(modelId) === kind).map(modelId => ({ id: modelId, displayName: rowDisplayName(rows, modelId) }));
}

function rowDisplayName(rows: any[], modelId: string) {
  return String(rows.find(row => row.model_id === modelId)?.display_name || displayAiModelName(modelId));
}

export async function isModelAllowedForPlan(planKey: string, modelId: string): Promise<boolean> {
  await ensureAiCommercialSchema();
  const rows = await query<any>(`SELECT d.model_id,d.display_name,d.model_version,d.supported_generation_methods,d.input_modalities,d.output_modalities,d.input_token_limit,d.output_token_limit,d.lifecycle_status,GROUP_CONCAT(DISTINCT r.metric) AS active_metrics
    FROM ai_provider_rates r
    JOIN ai_discovered_models d ON d.provider=r.provider AND d.model_id=r.model_id AND d.lifecycle_status<>'retired'
    JOIN ai_provider_models m ON m.provider=r.provider AND m.model_id=r.model_id AND m.is_allowed=1
    JOIN ai_plans p ON p.plan_key=?
    WHERE r.provider='google' AND r.model_id=? AND r.effective_from<=NOW(3) AND (r.effective_to IS NULL OR r.effective_to>NOW(3))
      AND (p.pricing_mode='markup' OR EXISTS (
        SELECT 1 FROM ai_plan_rates pr WHERE pr.plan_key=p.plan_key AND pr.model_id=r.model_id
          AND pr.effective_from<=NOW(3) AND (pr.effective_to IS NULL OR pr.effective_to>NOW(3))
        )) GROUP BY d.model_id,d.display_name,d.model_version,d.supported_generation_methods,d.input_modalities,d.output_modalities,d.input_token_limit,d.output_token_limit,d.lifecycle_status LIMIT 1`, [planKey, modelId]);
      return rows.length > 0 && completeRow(rows[0]);
}