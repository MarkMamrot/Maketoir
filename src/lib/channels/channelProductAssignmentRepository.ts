import { createHash } from 'node:crypto';

import {
  CHANNEL_PRODUCT_RULE_FIELDS,
  CHANNEL_PRODUCT_RULE_OPERATORS,
  evaluateChannelProductRules,
  type ChannelProductOverrideMode,
  type ChannelProductRuleCondition,
  type ChannelProductRuleContext,
  type ChannelProductRuleDefinition,
} from '@/lib/channels/channelProductRules';
import { getIMSPool, imsExecute, imsQuery } from '@/services/IMSMySQLService';

interface RuleRow {
  id: number;
  name: string;
  priority: number;
  is_enabled: number;
  match_mode: 'all' | 'any';
  decision: 'include' | 'exclude';
  conditions_json: string | ChannelProductRuleCondition[];
}

interface ProductContextRow {
  product_id: string;
  product_name: string;
  is_online: number;
  is_active: number;
  is_stock_item: number;
  description: string | null;
  website_title: string | null;
  product_type: string | null;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  tags: string | null;
  image_count: number | string;
  variant_count: number | string;
  override_mode: ChannelProductOverrideMode | null;
  provider_state: 'unknown' | 'unpublished' | 'pending' | 'published' | 'error' | null;
}

export interface ChannelProductEvaluationRow {
  productId: string;
  productName: string;
  onlineCandidate: boolean;
  ruleDecision: 'include' | 'exclude';
  effectiveDecision: 'include' | 'exclude';
  matchedRuleId: number | string | null;
  matchedRuleName: string | null;
  overrideMode: ChannelProductOverrideMode;
  providerState: ProductContextRow['provider_state'];
}

function parseConditions(value: RuleRow['conditions_json']): ChannelProductRuleCondition[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function normalizeConditions(value: unknown): ChannelProductRuleCondition[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error('Each channel rule requires between 1 and 20 conditions.');
  }
  return value.map(item => {
    const condition = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const field = String(condition.field ?? '');
    const operator = String(condition.operator ?? '');
    if (!CHANNEL_PRODUCT_RULE_FIELDS.includes(field as never)
      || !CHANNEL_PRODUCT_RULE_OPERATORS.includes(operator as never)) {
      throw new Error('A channel rule contains an unsupported condition.');
    }
    return { field, operator, value: condition.value } as ChannelProductRuleCondition;
  });
}

export async function listChannelProductRules(input: {
  businessId: string;
  channelInstanceId: string;
}): Promise<ChannelProductRuleDefinition[]> {
  const rows = await imsQuery<RuleRow>(
    `SELECT id, name, priority, is_enabled, match_mode, decision, conditions_json
       FROM ims_sales_channel_product_rules
      WHERE business_id = ? AND channel_instance_id = ?
      ORDER BY priority, id`,
    [input.businessId, input.channelInstanceId],
  );
  return rows.map(row => ({
    id: Number(row.id), name: row.name, priority: Number(row.priority), enabled: row.is_enabled === 1,
    matchMode: row.match_mode, decision: row.decision, conditions: parseConditions(row.conditions_json),
  }));
}

export async function replaceChannelProductRules(input: {
  businessId: string;
  channelInstanceId: string;
  rules: Array<Partial<ChannelProductRuleDefinition>>;
  actorUserId?: number | null;
  actorName?: string | null;
}): Promise<ChannelProductRuleDefinition[]> {
  if (input.rules.length > 100) throw new Error('A channel can have at most 100 product rules.');
  const rules = input.rules.map((rule, index) => {
    const name = String(rule.name ?? '').trim().slice(0, 120);
    if (!name) throw new Error('Every channel rule requires a name.');
    return {
      name,
      priority: (index + 1) * 10,
      enabled: rule.enabled !== false,
      matchMode: rule.matchMode === 'any' ? 'any' as const : 'all' as const,
      decision: rule.decision === 'exclude' ? 'exclude' as const : 'include' as const,
      conditions: normalizeConditions(rule.conditions),
    };
  });
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      'DELETE FROM ims_sales_channel_product_rules WHERE business_id = ? AND channel_instance_id = ?',
      [input.businessId, input.channelInstanceId],
    );
    for (const rule of rules) {
      await connection.query(
        `INSERT INTO ims_sales_channel_product_rules
           (business_id, channel_instance_id, name, priority, is_enabled, match_mode, decision,
            conditions_json, created_by_user_id, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.businessId, input.channelInstanceId, rule.name, rule.priority, rule.enabled ? 1 : 0,
          rule.matchMode, rule.decision, JSON.stringify(rule.conditions), input.actorUserId ?? null,
          input.actorName?.trim().slice(0, 120) || null],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return listChannelProductRules(input);
}

function contextFromRow(row: ProductContextRow): ChannelProductRuleContext {
  return {
    online_candidate: row.is_online === 1,
    active: row.is_active === 1,
    stock_item: row.is_stock_item === 1,
    description: row.description,
    website_title: row.website_title,
    product_type: row.product_type,
    category: row.category,
    subcategory: row.subcategory,
    brand: row.brand,
    tags: String(row.tags ?? '').split(',').map(tag => tag.trim()).filter(Boolean),
    image_count: Number(row.image_count),
    variant_count: Number(row.variant_count),
  };
}

export async function evaluateChannelProducts(input: {
  businessId: string;
  channelInstanceId: string;
  apply?: boolean;
  productId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ products: ChannelProductEvaluationRow[]; total: number; applied: number }> {
  const rules = await listChannelProductRules(input);
  const productId = String(input.productId ?? '').trim();
  const search = String(input.search ?? '').trim();
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const whereProduct = productId ? ' AND product.product_id = ?' : '';
  const whereSearch = search ? ' AND (product.name LIKE ? OR product.base_sku LIKE ? OR product.brand LIKE ?)' : '';
  const params: unknown[] = [input.channelInstanceId, input.businessId];
  if (productId) params.push(productId);
  if (search) params.push(...Array(3).fill(`%${search}%`));
  const rows = await imsQuery<ProductContextRow>(
    `SELECT product.product_id, product.name AS product_name, product.is_online, product.is_active,
            product.is_stock_item, product.description, product.website_title, product.product_type,
            product.category, product.subcategory, product.brand, product.tags,
            COALESCE(images.image_count, 0) AS image_count,
            COALESCE(variants.variant_count, 0) AS variant_count,
            assignment.override_mode, assignment.provider_state
       FROM ims_products product
       LEFT JOIN (SELECT product_id, COUNT(*) AS image_count FROM ims_product_images GROUP BY product_id) images
         ON images.product_id = product.product_id
       LEFT JOIN (SELECT business_id, product_id, COUNT(*) AS variant_count FROM ims_product_variants
                   WHERE is_active = 1 GROUP BY business_id, product_id) variants
         ON variants.business_id = product.business_id AND variants.product_id = product.product_id
       LEFT JOIN ims_sales_channel_product_assignments assignment
         ON assignment.business_id = product.business_id AND assignment.channel_instance_id = ?
        AND assignment.product_id = product.product_id
      WHERE product.business_id = ?${whereProduct}${whereSearch}
      ORDER BY product.name, product.product_id LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const countParams: unknown[] = [input.businessId];
  if (productId) countParams.push(productId);
  if (search) countParams.push(...Array(3).fill(`%${search}%`));
  const countRows = await imsQuery<{ total: number | string }>(
    `SELECT COUNT(*) AS total FROM ims_products product WHERE product.business_id = ?${whereProduct}${whereSearch}`,
    countParams,
  );
  const evaluated = rows.map(row => {
    const context = contextFromRow(row);
    const result = evaluateChannelProductRules({ context, rules, overrideMode: row.override_mode ?? 'automatic' });
    return { row, context, result, hash: createHash('sha256').update(JSON.stringify({ context, rules,
      overrideMode: result.overrideMode })).digest('hex') };
  });
  let applied = 0;
  if (input.apply && evaluated.length > 0) {
    const placeholders = evaluated.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))').join(',');
    const values = evaluated.flatMap(item => [
      input.businessId, input.channelInstanceId, item.row.product_id, item.result.ruleDecision,
      typeof item.result.matchedRuleId === 'number' ? item.result.matchedRuleId : null, item.result.overrideMode,
      item.result.effectiveDecision === 'include' ? 'published' : 'unpublished', item.hash,
    ]);
    await imsExecute(
      `INSERT INTO ims_sales_channel_product_assignments
         (business_id, channel_instance_id, product_id, rule_decision, matched_rule_id, override_mode,
          desired_state, evaluation_hash, evaluated_at)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE rule_decision = VALUES(rule_decision), matched_rule_id = VALUES(matched_rule_id),
         desired_state = VALUES(desired_state), evaluation_hash = VALUES(evaluation_hash),
         evaluated_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)`,
      values,
    );
    applied = evaluated.length;
  }
  return {
    products: evaluated.map(item => ({
      productId: item.row.product_id,
      productName: item.row.product_name,
      onlineCandidate: item.context.online_candidate,
      ruleDecision: item.result.ruleDecision,
      effectiveDecision: item.result.effectiveDecision,
      matchedRuleId: item.result.matchedRuleId,
      matchedRuleName: item.result.matchedRuleName,
      overrideMode: item.result.overrideMode,
      providerState: item.row.provider_state ?? 'unknown',
    })),
    total: Number(countRows[0]?.total ?? 0),
    applied,
  };
}

export async function setChannelProductOverride(input: {
  businessId: string;
  channelInstanceId: string;
  productId: string;
  overrideMode: ChannelProductOverrideMode;
}): Promise<void> {
  if (!['automatic', 'include', 'exclude'].includes(input.overrideMode)) throw new Error('Invalid channel product override.');
  await imsExecute(
    `INSERT INTO ims_sales_channel_product_assignments
       (business_id, channel_instance_id, product_id, rule_decision, override_mode, desired_state)
     SELECT product.business_id, ?, product.product_id, 'exclude', ?,
            IF(? = 'include', 'published', 'unpublished')
       FROM ims_products product WHERE product.business_id = ? AND product.product_id = ?
     ON DUPLICATE KEY UPDATE override_mode = VALUES(override_mode),
       desired_state = CASE
         WHEN VALUES(override_mode) = 'automatic' THEN IF(rule_decision = 'include', 'published', 'unpublished')
         WHEN VALUES(override_mode) = 'include' THEN 'published' ELSE 'unpublished' END,
       updated_at = CURRENT_TIMESTAMP(3)`,
    [input.channelInstanceId, input.overrideMode, input.overrideMode, input.businessId, input.productId],
  );
}