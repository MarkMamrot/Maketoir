export const CHANNEL_PRODUCT_RULE_FIELDS = [
  'online_candidate',
  'active',
  'stock_item',
  'description',
  'website_title',
  'product_type',
  'category',
  'subcategory',
  'brand',
  'tags',
  'image_count',
  'variant_count',
] as const;

export type ChannelProductRuleField = typeof CHANNEL_PRODUCT_RULE_FIELDS[number];

export const CHANNEL_PRODUCT_RULE_OPERATORS = [
  'equals',
  'not_equals',
  'is_present',
  'is_not_present',
  'contains',
  'not_contains',
  'in',
  'not_in',
  'greater_than_or_equal',
] as const;

export type ChannelProductRuleOperator = typeof CHANNEL_PRODUCT_RULE_OPERATORS[number];
export type ChannelProductRuleDecision = 'include' | 'exclude';
export type ChannelProductOverrideMode = 'automatic' | 'include' | 'exclude';
export type ChannelProductDesiredState = 'published' | 'unpublished';

import type { ChannelProductAssignmentMode } from './types';

export interface ChannelProductRuleCondition {
  field: ChannelProductRuleField;
  operator: ChannelProductRuleOperator;
  value?: string | number | boolean | string[];
}

export interface ChannelProductRuleDefinition {
  id: number | string;
  name: string;
  priority: number;
  enabled: boolean;
  matchMode: 'all' | 'any';
  decision: ChannelProductRuleDecision;
  conditions: ChannelProductRuleCondition[];
}

export interface ChannelProductRuleContext {
  online_candidate: boolean;
  active: boolean;
  stock_item: boolean;
  description: string | null;
  website_title: string | null;
  product_type: string | null;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  tags: string[];
  image_count: number;
  variant_count: number;
}

export interface ChannelProductRuleEvaluation {
  ruleDecision: ChannelProductRuleDecision;
  effectiveDecision: ChannelProductRuleDecision;
  matchedRuleId: number | string | null;
  matchedRuleName: string | null;
  overrideMode: ChannelProductOverrideMode;
}

export function resolveChannelProductDesiredState(input: {
  assignmentMode: ChannelProductAssignmentMode;
  ruleDecision: ChannelProductRuleDecision;
  overrideMode: ChannelProductOverrideMode;
  currentDesiredState?: ChannelProductDesiredState | null;
}): ChannelProductDesiredState {
  if (input.overrideMode === 'include') return 'published';
  if (input.overrideMode === 'exclude') return 'unpublished';
  if (input.assignmentMode === 'add_matches' && input.ruleDecision === 'include') return 'published';
  return input.currentDesiredState ?? 'unpublished';
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('en-AU');
}

function present(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : typeof value === 'boolean' || typeof value === 'number'
    ? true
    : normalized(value).length > 0;
}

function matchesCondition(context: ChannelProductRuleContext, condition: ChannelProductRuleCondition): boolean {
  const actual = context[condition.field];
  const expected = condition.value;
  switch (condition.operator) {
    case 'is_present': return present(actual);
    case 'is_not_present': return !present(actual);
    case 'greater_than_or_equal': return Number(actual) >= Number(expected);
    case 'contains': {
      if (Array.isArray(actual)) return actual.some(value => normalized(value) === normalized(expected));
      return normalized(actual).includes(normalized(expected));
    }
    case 'not_contains': {
      if (Array.isArray(actual)) return actual.every(value => normalized(value) !== normalized(expected));
      return !normalized(actual).includes(normalized(expected));
    }
    case 'in': {
      const values = Array.isArray(expected) ? expected : [String(expected ?? '')];
      return values.some(value => normalized(value) === normalized(actual));
    }
    case 'not_in': {
      const values = Array.isArray(expected) ? expected : [String(expected ?? '')];
      return values.every(value => normalized(value) !== normalized(actual));
    }
    case 'equals': {
      if (typeof actual === 'boolean') return actual === (expected === true || expected === 'true' || expected === 1);
      if (typeof actual === 'number') return actual === Number(expected);
      return normalized(actual) === normalized(expected);
    }
    case 'not_equals': {
      if (typeof actual === 'boolean') return actual !== (expected === true || expected === 'true' || expected === 1);
      if (typeof actual === 'number') return actual !== Number(expected);
      return normalized(actual) !== normalized(expected);
    }
  }
}

export function evaluateChannelProductRules(input: {
  context: ChannelProductRuleContext;
  rules: ChannelProductRuleDefinition[];
  overrideMode?: ChannelProductOverrideMode;
}): ChannelProductRuleEvaluation {
  const orderedRules = input.rules.filter(rule => rule.enabled && rule.conditions.length > 0)
    .sort((left, right) => left.priority - right.priority || String(left.id).localeCompare(String(right.id)));
  const matchedRule = orderedRules.find(rule => rule.matchMode === 'all'
    ? rule.conditions.every(condition => matchesCondition(input.context, condition))
    : rule.conditions.some(condition => matchesCondition(input.context, condition)));
  const ruleDecision = matchedRule?.decision ?? 'exclude';
  const overrideMode = input.overrideMode ?? 'automatic';
  return {
    ruleDecision,
    effectiveDecision: overrideMode === 'automatic' ? ruleDecision : overrideMode,
    matchedRuleId: matchedRule?.id ?? null,
    matchedRuleName: matchedRule?.name ?? null,
    overrideMode,
  };
}
