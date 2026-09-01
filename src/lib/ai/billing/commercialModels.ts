import { query } from '@/services/MySQLService';
import { ensureAiCommercialSchema } from './commercialSchema';

export type AiModelKind = 'text' | 'image' | 'video';

export function classifyAiModel(modelId: string): AiModelKind {
  if (/^veo-|video|omni/i.test(modelId)) return 'video';
  if (/image/i.test(modelId)) return 'image';
  return 'text';
}

import type { AiRateMetric } from './types';
import { curatedAiModel, hasCompleteCuratedPricing, isCuratedAiModel } from './curatedModels';
export function displayAiModelName(modelId: string): string {
  return modelId.split('-').map(part => /^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}


const completeRow = (row: any) => hasCompleteCuratedPricing(String(row.model_id), String(row.active_metrics || '').split(',').filter(Boolean) as AiRateMetric[]);
export async function listAllowedModelsForBusiness(businessId: string, kind: AiModelKind) {
  await ensureAiCommercialSchema();
  const rows = await query<any>(`SELECT r.model_id,GROUP_CONCAT(DISTINCT r.metric) AS active_metrics
    FROM ai_provider_rates r
    JOIN ai_provider_models m ON m.provider=r.provider AND m.model_id=r.model_id AND m.is_allowed=1
    JOIN business_ai_accounts a ON a.business_id=?
    JOIN ai_plans p ON p.plan_key=a.plan_key
    WHERE r.provider='google' AND r.effective_from<=NOW(3) AND (r.effective_to IS NULL OR r.effective_to>NOW(3))
      AND p.pricing_mode='markup'
    GROUP BY r.model_id ORDER BY r.model_id`, [businessId]);
  return rows.filter(completeRow).map(row => String(row.model_id)).filter(modelId => isCuratedAiModel(modelId, kind)).map(modelId => ({ id: modelId, displayName: curatedAiModel(modelId)!.name }));
}

export async function isModelAllowedForPlan(planKey: string, modelId: string): Promise<boolean> {
  if (!isCuratedAiModel(modelId)) return false;
  await ensureAiCommercialSchema();
  const rows = await query<any>(`SELECT r.model_id,GROUP_CONCAT(DISTINCT r.metric) AS active_metrics
    FROM ai_provider_rates r
    JOIN ai_provider_models m ON m.provider=r.provider AND m.model_id=r.model_id AND m.is_allowed=1
    JOIN ai_plans p ON p.plan_key=?
    WHERE r.provider='google' AND r.model_id=? AND r.effective_from<=NOW(3) AND (r.effective_to IS NULL OR r.effective_to>NOW(3))
      AND p.pricing_mode='markup' GROUP BY r.model_id LIMIT 1`, [planKey, modelId]);
      return rows.length > 0 && completeRow(rows[0]);
}