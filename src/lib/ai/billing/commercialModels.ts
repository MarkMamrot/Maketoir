import { query } from '@/services/MySQLService';
import { ensureAiCommercialSchema } from './commercialSchema';

export type AiModelKind = 'text' | 'image' | 'video';

export function classifyAiModel(modelId: string): AiModelKind {
  if (/^veo-|video|omni/i.test(modelId)) return 'video';
  if (/image/i.test(modelId)) return 'image';
  return 'text';
}

export function displayAiModelName(modelId: string): string {
  return modelId.split('-').map(part => /^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export async function listAllowedModelsForBusiness(businessId: string, kind: AiModelKind) {
  await ensureAiCommercialSchema();
  const rows = await query<any>(`SELECT DISTINCT r.model_id
    FROM ai_provider_rates r
    JOIN ai_provider_models m ON m.provider=r.provider AND m.model_id=r.model_id AND m.is_allowed=1
    JOIN business_ai_accounts a ON a.business_id=?
    JOIN ai_plans p ON p.plan_key=a.plan_key
    WHERE r.provider='google' AND r.effective_from<=NOW(3) AND (r.effective_to IS NULL OR r.effective_to>NOW(3))
      AND (p.pricing_mode='markup' OR EXISTS (
        SELECT 1 FROM ai_plan_rates pr WHERE pr.plan_key=p.plan_key AND pr.model_id=r.model_id
          AND pr.effective_from<=NOW(3) AND (pr.effective_to IS NULL OR pr.effective_to>NOW(3))
      ))
    ORDER BY r.model_id`, [businessId]);
  return rows.map(row => String(row.model_id)).filter(modelId => classifyAiModel(modelId) === kind).map(modelId => ({ id: modelId, displayName: displayAiModelName(modelId) }));
}

export async function isModelAllowedForPlan(planKey: string, modelId: string): Promise<boolean> {
  await ensureAiCommercialSchema();
  const rows = await query<any>(`SELECT 1
    FROM ai_provider_rates r
    JOIN ai_provider_models m ON m.provider=r.provider AND m.model_id=r.model_id AND m.is_allowed=1
    JOIN ai_plans p ON p.plan_key=?
    WHERE r.provider='google' AND r.model_id=? AND r.effective_from<=NOW(3) AND (r.effective_to IS NULL OR r.effective_to>NOW(3))
      AND (p.pricing_mode='markup' OR EXISTS (
        SELECT 1 FROM ai_plan_rates pr WHERE pr.plan_key=p.plan_key AND pr.model_id=r.model_id
          AND pr.effective_from<=NOW(3) AND (pr.effective_to IS NULL OR pr.effective_to>NOW(3))
      )) LIMIT 1`, [planKey, modelId]);
  return rows.length > 0;
}