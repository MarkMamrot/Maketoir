import { BrandProfileRepository } from '@/lib/db/BrandProfileRepository';
import { BusinessInfoRepository } from '@/lib/db/BusinessInfoRepository';
import { parseMarketingStrategy } from '../marketingStrategy';
import { ForesightRepository } from '../repositories/ForesightRepository';
import { ImsCommerceRepository } from '../repositories/ImsCommerceRepository';
import { ImsInboundPlanningRepository } from '../repositories/ImsInboundPlanningRepository';
import { ImsProductPlanningRepository } from '../repositories/ImsProductPlanningRepository';
import type { DataQualityResult, RecommendationState } from '../types';

export const FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION = 'foresight-planner-tools-v1';

export const FORESIGHT_PLANNER_TOOL_NAMES = [
  'get_business_context',
  'get_marketing_strategy',
  'get_commerce_performance',
  'get_product_inventory_signals',
  'get_open_inbound_stock',
  'list_recommendations',
  'get_recommendation',
] as const;

export type ForesightPlannerToolName = typeof FORESIGHT_PLANNER_TOOL_NAMES[number];
export type PlannerFactAuthority = 'authoritative' | 'diagnostic' | 'human';

export interface PlannerFact {
  factId: string;
  label: string;
  source: string;
  authority: PlannerFactAuthority;
  observedFrom: string | null;
  observedThrough: string | null;
  freshnessAt: string | null;
  quality: DataQualityResult;
  value: Record<string, unknown>;
}

export interface ForesightPlannerToolResult {
  tool: ForesightPlannerToolName;
  manifestVersion: typeof FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION;
  facts: PlannerFact[];
  truncated: boolean;
}

type JsonObject = Record<string, unknown>;

const ACTIVE_RECOMMENDATION_STATES: RecommendationState[] = [
  'shadow', 'pending_approval', 'approved', 'executing', 'succeeded', 'failed', 'rejected',
];

export const FORESIGHT_PLANNER_TOOL_DECLARATIONS = [
  {
    name: 'get_business_context',
    description: 'Get approved business identity and brand-strategy context. Returns no credentials or customer data.',
    required: [],
    optional: [],
  },
  {
    name: 'get_marketing_strategy',
    description: 'Get the current deterministic Foresight marketing strategy and guardrails.',
    required: [],
    optional: [],
  },
  {
    name: 'get_commerce_performance',
    description: 'Get authoritative online and POS revenue, returns, COGS, contribution, and order totals for an explicit date range of up to 90 days.',
    required: ['from', 'to'],
    optional: [],
  },
  {
    name: 'get_product_inventory_signals',
    description: 'Get bounded product-level sales velocity, organization-wide cost, margin, stock availability, inbound stock, and deterministic inventory signals.',
    required: [],
    optional: ['limit'],
  },
  {
    name: 'get_open_inbound_stock',
    description: 'Get bounded outstanding purchase-order quantities and expected delivery timing for marketing stock planning.',
    required: [],
    optional: ['limit'],
  },
  {
    name: 'list_recommendations',
    description: 'List bounded current Foresight recommendation summaries by workflow state.',
    required: [],
    optional: ['states', 'limit'],
  },
  {
    name: 'get_recommendation',
    description: 'Get one recommendation evidence snapshot and proposed review action by recommendation ID.',
    required: ['recommendationId'],
    optional: [],
  },
] as const;

function goodQuality(): DataQualityResult {
  return { grade: 'good', issues: [] };
}

function roundNumber(value: number, precision = 4): number {
  const scale = 10 ** precision;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function assertExactArguments(args: JsonObject, allowed: readonly string[]): void {
  const unexpected = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new Error(`Unexpected planner tool arguments: ${unexpected.join(', ')}`);
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${path} must be a positive integer`);
  return parsed;
}

function boundedLimit(value: unknown, fallback = 20, maximum = 50): number {
  if (value == null) return fallback;
  return Math.max(1, Math.min(maximum, positiveInteger(value, 'limit')));
}

function boundedDateRange(args: JsonObject): { from: string; to: string } {
  const from = typeof args.from === 'string' ? args.from.trim() : '';
  const to = typeof args.to === 'string' ? args.to.trim() : '';
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(from) || !pattern.test(to)) throw new Error('from and to must be ISO dates (YYYY-MM-DD)');
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(fromDate.getTime()) || fromDate.toISOString().slice(0, 10) !== from
    || Number.isNaN(toDate.getTime()) || toDate.toISOString().slice(0, 10) !== to) {
    throw new Error('from and to must be valid calendar dates');
  }
  const inclusiveDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (inclusiveDays < 1 || inclusiveDays > 90) throw new Error('commerce date range must contain 1 to 90 days');
  return { from, to };
}

function recommendationStates(value: unknown): RecommendationState[] {
  if (value == null) return ACTIVE_RECOMMENDATION_STATES;
  if (!Array.isArray(value) || value.length === 0) throw new Error('states must be a non-empty array');
  const unique = [...new Set(value.map((state) => String(state)))] as RecommendationState[];
  for (const state of unique) {
    if (!ACTIVE_RECOMMENDATION_STATES.includes(state)) throw new Error(`Unsupported recommendation state: ${state}`);
  }
  return unique;
}

function compactBusinessInfo(row: Awaited<ReturnType<typeof BusinessInfoRepository.get>>): Record<string, unknown> | null {
  if (!row) return null;
  return {
    brandName: row.brand_name,
    brandUrl: row.brand_url,
    yearsInBusiness: row.years_in_business,
    facebookUrl: row.facebook_link,
    instagramUrl: row.instagram_link,
    pinterestUrl: row.pinterest_link,
  };
}

function compactBrandProfile(row: Awaited<ReturnType<typeof BrandProfileRepository.get>>): Record<string, unknown> | null {
  if (!row) return null;
  return {
    mission: row.mission,
    uniqueValueProposition: row.uvp,
    tone: row.tone,
    targetDemographics: row.demographics,
    targetGeography: row.geo,
    heroProducts: row.hero_products,
    pricePositioning: row.price_positioning,
    customerPraises: row.praises,
    customerObjections: row.objections,
    competitors: row.competitors,
    marketGap: row.market_gap,
    brandColours: row.brand_colours,
    operationsSummary: row.operations_summary,
    brandHistory: row.brand_history,
    brandAesthetic: row.detailed_brand_aesthetic,
    physicalBranches: row.physical_branches,
    loyaltyProgram: row.loyalty_program,
  };
}

async function getBusinessContext(businessId: string): Promise<ForesightPlannerToolResult> {
  const [business, brand] = await Promise.all([
    BusinessInfoRepository.get(businessId),
    BrandProfileRepository.get(businessId),
  ]);
  const facts: PlannerFact[] = [];
  if (business) facts.push({
    factId: `business-context:identity:${businessId}`,
    label: 'Business identity',
    source: 'Business Information',
    authority: 'human',
    observedFrom: null,
    observedThrough: null,
    freshnessAt: business.updated_at,
    quality: goodQuality(),
    value: compactBusinessInfo(business)!,
  });
  if (brand) facts.push({
    factId: `business-context:brand-profile:${businessId}`,
    label: 'Brand profile',
    source: 'Brand Profile',
    authority: 'human',
    observedFrom: null,
    observedThrough: null,
    freshnessAt: brand.updated_at,
    quality: goodQuality(),
    value: compactBrandProfile(brand)!,
  });
  return { tool: 'get_business_context', manifestVersion: FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION, facts, truncated: false };
}

async function getMarketingStrategy(businessId: string): Promise<ForesightPlannerToolResult> {
  const stored = await ForesightRepository.latestStrategy(businessId);
  if (!stored) {
    return { tool: 'get_marketing_strategy', manifestVersion: FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION, facts: [], truncated: false };
  }
  const strategy = parseMarketingStrategy(stored.strategy_json);
  return {
    tool: 'get_marketing_strategy',
    manifestVersion: FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION,
    facts: [{
      factId: `foresight:strategy:${stored.id}:v${stored.version}`,
      label: `Marketing strategy version ${stored.version}`,
      source: 'Foresight Strategy',
      authority: 'authoritative',
      observedFrom: null,
      observedThrough: null,
      freshnessAt: stored.created_at,
      quality: goodQuality(),
      value: { version: stored.version, strategy, changeReason: stored.change_reason },
    }],
    truncated: false,
  };
}

async function getCommercePerformance(businessId: string, args: JsonObject): Promise<ForesightPlannerToolResult> {
  assertExactArguments(args, ['from', 'to']);
  const { from, to } = boundedDateRange(args);
  const observations = await ImsCommerceRepository.getDailyCommerce(businessId, from, to);
  const channels = ['online', 'pos'] as const;
  const summaries = channels.map((channel) => {
    const rows = observations.filter((row) => row.channel === channel);
    const salesIncTax = rows.reduce((sum, row) => sum + row.salesIncTax, 0);
    const salesTax = rows.reduce((sum, row) => sum + row.salesTax, 0);
    const returnsIncTax = rows.reduce((sum, row) => sum + row.returnsIncTax, 0);
    const returnsTax = rows.reduce((sum, row) => sum + row.returnsTax, 0);
    const netRevenueExTax = salesIncTax - salesTax - (returnsIncTax - returnsTax);
    const netCogs = rows.reduce((sum, row) => sum + row.salesCogs - row.returnedCogs, 0);
    const missingCostLineCount = rows.reduce((sum, row) => sum + row.missingCostLineCount, 0);
    const costBases = [...new Set(rows.filter((row) => row.costLineCount > 0).map((row) => row.costBasis))];
    return {
      channel,
      salesIncTax,
      salesTax,
      returnsIncTax,
      returnsTax,
      netRevenueExTax,
      netCogs: missingCostLineCount > 0 ? null : netCogs,
      contributionBeforeMarketing: missingCostLineCount > 0 ? null : netRevenueExTax - netCogs,
      orderCount: rows.reduce((sum, row) => sum + row.orderCount, 0),
      returnCount: rows.reduce((sum, row) => sum + row.returnCount, 0),
      costLineCount: rows.reduce((sum, row) => sum + row.costLineCount, 0),
      missingCostLineCount,
      costBasis: costBases.length === 1 ? costBases[0] : costBases.length > 1 ? 'mixed' : 'estimated',
    };
  });
  const missingCostLineCount = summaries.reduce((sum, item) => sum + item.missingCostLineCount, 0);
  const estimatedChannels = summaries.filter((item) => item.costLineCount > 0 && item.costBasis !== 'captured');
  const quality: DataQualityResult = missingCostLineCount > 0 ? {
    grade: 'blocked',
    issues: [{
      code: 'incomplete_commerce_cogs',
      severity: 'blocking',
      message: `${missingCostLineCount} sale or return lines have no usable cost; contribution is unavailable for affected channels.`,
    }],
  } : estimatedChannels.length > 0 ? {
    grade: 'partial',
    issues: [{
      code: 'estimated_commerce_cogs',
      severity: 'warning',
      message: `COGS uses estimated or mixed cost basis for: ${estimatedChannels.map((item) => item.channel).join(', ')}.`,
    }],
  } : goodQuality();
  return {
    tool: 'get_commerce_performance',
    manifestVersion: FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION,
    facts: [{
      factId: `ims:commerce-performance:${from}:${to}`,
      label: 'Commerce performance',
      source: 'IMS Commerce Ledger',
      authority: 'authoritative',
      observedFrom: from,
      observedThrough: to,
      freshnessAt: to,
      quality,
      value: { channels: summaries },
    }],
    truncated: false,
  };
}

async function getProductInventorySignals(businessId: string, args: JsonObject): Promise<ForesightPlannerToolResult> {
  assertExactArguments(args, ['limit']);
  const limit = boundedLimit(args.limit, 25, 50);
  const rows = await ImsProductPlanningRepository.listProductPlanningRows(businessId, limit);
  const today = new Date().toISOString().slice(0, 10);
  return {
    tool: 'get_product_inventory_signals',
    manifestVersion: FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION,
    facts: rows.map((row) => {
      const averageDailySales = row.salesQuantity90Days / 90;
      const daysOfAvailableStock = averageDailySales > 0 ? row.stockAvailable / averageDailySales : null;
      const daysIncludingIncoming = averageDailySales > 0
        ? (row.stockAvailable + row.stockIncoming) / averageDailySales
        : null;
      const signal = row.stockAvailable > 0 && (row.salesQuantity90Days <= 0 || (daysOfAvailableStock ?? 0) > 180)
        ? 'excess_stock'
        : row.salesQuantity90Days > 0 && (daysIncludingIncoming ?? 0) < 30
          ? 'stockout_risk'
          : 'balanced';
      const cacheDate = row.cacheUpdatedAt ? String(row.cacheUpdatedAt).slice(0, 10) : null;
      const cacheAgeDays = cacheDate
        ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${cacheDate}T00:00:00Z`)) / 86_400_000)
        : null;
      const quality: DataQualityResult = cacheDate == null ? {
        grade: 'blocked',
        issues: [{ code: 'missing_sales_stock_cache', severity: 'blocking', message: 'No refreshed sales and stock cache exists for this product.' }],
      } : cacheAgeDays != null && cacheAgeDays > 2 ? {
        grade: 'partial',
        issues: [{ code: 'stale_sales_stock_cache', severity: 'warning', message: `Sales and stock cache is ${cacheAgeDays} days old.` }],
      } : row.averageCostExTax == null ? {
        grade: 'partial',
        issues: [{ code: 'missing_average_cost', severity: 'warning', message: 'Organization-wide average cost is unavailable; margin cannot be calculated.' }],
      } : goodQuality();
      const observedFrom = cacheDate
        ? new Date(Date.parse(`${cacheDate}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10)
        : null;
      const priceExTax = row.priceIncTax == null ? null : row.priceIncTax / 1.1;
      return {
        factId: `ims:product-inventory:${row.variantId}:${cacheDate ?? 'uncached'}`,
        label: `${row.productName}${row.variantLabel === 'Default' ? '' : ` / ${row.variantLabel}`}`,
        source: 'IMS Product, Sales and Stock Cache',
        authority: 'authoritative' as const,
        observedFrom,
        observedThrough: cacheDate,
        freshnessAt: row.cacheUpdatedAt,
        quality,
        value: {
          variantId: row.variantId,
          sku: row.sku,
          productName: row.productName,
          variantLabel: row.variantLabel,
          brand: row.brand,
          productType: row.productType,
          isOnline: row.isOnline,
          signal,
          salesQuantity90Days: row.salesQuantity90Days,
          averageDailySales,
          stockOnHand: row.stockOnHand,
          stockAvailable: row.stockAvailable,
          stockIncoming: row.stockIncoming,
          daysOfAvailableStock,
          daysIncludingIncoming,
          priceIncTax: row.priceIncTax,
          averageCostExTax: row.averageCostExTax,
          unitGrossMarginExTax: priceExTax != null && row.averageCostExTax != null
            ? roundNumber(priceExTax - row.averageCostExTax)
            : null,
        },
      };
    }),
    truncated: false,
  };
}

async function getOpenInboundStock(businessId: string, args: JsonObject): Promise<ForesightPlannerToolResult> {
  assertExactArguments(args, ['limit']);
  const limit = boundedLimit(args.limit, 25, 50);
  const rows = await ImsInboundPlanningRepository.listOpenInbound(businessId, limit);
  const today = new Date().toISOString().slice(0, 10);
  return {
    tool: 'get_open_inbound_stock',
    manifestVersion: FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION,
    facts: rows.map((row) => {
      const daysUntilExpected = row.expectedDate == null
        ? null
        : Math.floor((Date.parse(`${row.expectedDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
      const timing = daysUntilExpected == null
        ? 'unknown'
        : daysUntilExpected < 0 ? 'overdue' : daysUntilExpected <= 14 ? 'due_soon' : 'scheduled';
      const quality: DataQualityResult = row.expectedDate == null ? {
        grade: 'partial',
        issues: [{ code: 'missing_expected_delivery_date', severity: 'warning', message: 'Purchase order has no expected delivery date.' }],
      } : goodQuality();
      return {
        factId: `ims:inbound-stock:${row.purchaseOrderId}:${row.variantId}:${row.updatedAt ?? row.orderDate}`,
        label: `${row.purchaseOrderNumber}: ${row.productName}${row.variantLabel === 'Default' ? '' : ` / ${row.variantLabel}`}`,
        source: 'IMS Purchase Orders',
        authority: 'authoritative' as const,
        observedFrom: row.orderDate,
        observedThrough: row.expectedDate,
        freshnessAt: row.updatedAt,
        quality,
        value: {
          purchaseOrderId: row.purchaseOrderId,
          purchaseOrderNumber: row.purchaseOrderNumber,
          status: row.status,
          supplierName: row.supplierName,
          variantId: row.variantId,
          sku: row.sku,
          productName: row.productName,
          variantLabel: row.variantLabel,
          quantityOrdered: row.quantityOrdered,
          quantityReceived: row.quantityReceived,
          quantityOutstanding: row.quantityOutstanding,
          orderDate: row.orderDate,
          expectedDate: row.expectedDate,
          daysUntilExpected,
          timing,
        },
      };
    }),
    truncated: false,
  };
}

function recommendationFact(row: Awaited<ReturnType<typeof ForesightRepository.getRecommendation>> extends infer T ? Exclude<T, null> : never): PlannerFact {
  return {
    factId: `foresight:recommendation:${row.id}:${row.fingerprint}`,
    label: `${row.rule_id} recommendation`,
    source: 'Foresight Recommendation Ledger',
    authority: row.evidence_json.metricKeys.some((key) => key.includes('ga4') || key.includes('meta_ads_platform'))
      ? 'diagnostic'
      : 'authoritative',
    observedFrom: row.evidence_json.windowStart,
    observedThrough: row.evidence_json.windowEnd,
    freshnessAt: row.updated_at,
    quality: row.evidence_json.quality,
    value: {
      recommendationId: row.id,
      state: row.state,
      channel: row.channel,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      ruleId: row.rule_id,
      observedValues: row.evidence_json.observedValues ?? {},
      contributors: row.evidence_json.contributors ?? [],
      lifecycleFlowCoverage: row.evidence_json.lifecycleFlowCoverage ?? [],
      proposedAction: row.proposed_action_json,
      confidence: row.confidence,
      expiresAt: row.expires_at,
    },
  };
}

async function listRecommendations(businessId: string, args: JsonObject): Promise<ForesightPlannerToolResult> {
  assertExactArguments(args, ['states', 'limit']);
  const limit = boundedLimit(args.limit);
  const rows = await ForesightRepository.listRecommendations(businessId, recommendationStates(args.states));
  const selected = rows.slice(0, limit);
  return {
    tool: 'list_recommendations',
    manifestVersion: FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION,
    facts: selected.map(recommendationFact),
    truncated: rows.length > selected.length,
  };
}

async function getRecommendation(businessId: string, args: JsonObject): Promise<ForesightPlannerToolResult> {
  assertExactArguments(args, ['recommendationId']);
  const row = await ForesightRepository.getRecommendation(
    businessId,
    positiveInteger(args.recommendationId, 'recommendationId'),
  );
  return {
    tool: 'get_recommendation',
    manifestVersion: FORESIGHT_PLANNER_TOOL_MANIFEST_VERSION,
    facts: row ? [recommendationFact(row)] : [],
    truncated: false,
  };
}

const TOOL_HANDLERS: Record<ForesightPlannerToolName, (businessId: string, args: JsonObject) => Promise<ForesightPlannerToolResult>> = {
  get_business_context: (businessId, args) => {
    assertExactArguments(args, []);
    return getBusinessContext(businessId);
  },
  get_marketing_strategy: (businessId, args) => {
    assertExactArguments(args, []);
    return getMarketingStrategy(businessId);
  },
  get_commerce_performance: getCommercePerformance,
  get_product_inventory_signals: getProductInventorySignals,
  get_open_inbound_stock: getOpenInboundStock,
  list_recommendations: listRecommendations,
  get_recommendation: getRecommendation,
};

export async function executeForesightPlannerTool(input: {
  businessId: string;
  enabledTools: readonly string[];
  name: string;
  args?: JsonObject;
}): Promise<ForesightPlannerToolResult> {
  if (!input.businessId.trim()) throw new Error('businessId is required');
  if (!FORESIGHT_PLANNER_TOOL_NAMES.includes(input.name as ForesightPlannerToolName)) {
    throw new Error(`Unknown Foresight planner tool: ${input.name}`);
  }
  if (!input.enabledTools.includes(input.name)) {
    throw new Error(`Foresight planner tool is disabled: ${input.name}`);
  }
  return TOOL_HANDLERS[input.name as ForesightPlannerToolName](input.businessId, input.args ?? {});
}