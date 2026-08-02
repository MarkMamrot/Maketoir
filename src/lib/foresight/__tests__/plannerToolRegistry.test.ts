import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBusinessGet, mockBrandGet, mockLatestStrategy, mockListRecommendations, mockGetRecommendation, mockListLearningOutcomes, mockListAcceptedLessons, mockListAcceptedExperimentConclusions, mockListAcceptedCreativeBriefs, mockGetDailyCommerce, mockListBrandPerformance, mockListProductPlanningRows, mockListOpenInbound } = vi.hoisted(() => ({
  mockBusinessGet: vi.fn(),
  mockBrandGet: vi.fn(),
  mockLatestStrategy: vi.fn(),
  mockListRecommendations: vi.fn(),
  mockGetRecommendation: vi.fn(),
  mockListLearningOutcomes: vi.fn(),
  mockListAcceptedLessons: vi.fn(),
  mockListAcceptedExperimentConclusions: vi.fn(),
  mockListAcceptedCreativeBriefs: vi.fn(),
  mockGetDailyCommerce: vi.fn(),
  mockListBrandPerformance: vi.fn(),
  mockListProductPlanningRows: vi.fn(),
  mockListOpenInbound: vi.fn(),
}));

vi.mock('@/lib/db/BusinessInfoRepository', () => ({ BusinessInfoRepository: { get: mockBusinessGet } }));
vi.mock('@/lib/db/BrandProfileRepository', () => ({ BrandProfileRepository: { get: mockBrandGet } }));
vi.mock('../repositories/ForesightRepository', () => ({
  ForesightRepository: {
    latestStrategy: mockLatestStrategy,
    listRecommendations: mockListRecommendations,
    getRecommendation: mockGetRecommendation,
  },
}));
vi.mock('../repositories/ForesightCampaignActivationRepository', () => ({
  ForesightCampaignActivationRepository: { listLearningOutcomes: mockListLearningOutcomes },
}));
vi.mock('../repositories/ForesightCampaignLessonRepository', () => ({
  ForesightCampaignLessonRepository: { listAccepted: mockListAcceptedLessons },
}));
vi.mock('../repositories/ForesightCampaignExperimentResultRepository', () => ({
  ForesightCampaignExperimentResultRepository: { listAcknowledged: mockListAcceptedExperimentConclusions },
}));
vi.mock('../repositories/ForesightCreativeBriefRepository', () => ({
  ForesightCreativeBriefRepository: { listAccepted: mockListAcceptedCreativeBriefs },
}));
vi.mock('../repositories/ImsCommerceRepository', () => ({
  ImsCommerceRepository: { getDailyCommerce: mockGetDailyCommerce },
}));
vi.mock('../repositories/ImsBrandPerformanceRepository', () => ({
  ImsBrandPerformanceRepository: { listBrandPerformance: mockListBrandPerformance },
}));
vi.mock('../repositories/ImsProductPlanningRepository', () => ({
  ImsProductPlanningRepository: { listProductPlanningRows: mockListProductPlanningRows },
}));
vi.mock('../repositories/ImsInboundPlanningRepository', () => ({
  ImsInboundPlanningRepository: { listOpenInbound: mockListOpenInbound },
}));

import {
  FORESIGHT_PLANNER_TOOL_NAMES,
  executeForesightPlannerTool,
} from '../assistant/plannerToolRegistry';

const recommendation = {
  id: 20,
  business_id: 'business-1',
  fingerprint: 'meta:window:p2',
  state: 'shadow',
  channel: 'paid_media',
  subject_type: 'channel',
  subject_id: 'meta_ads',
  rule_id: 'meta_channel_underperformance',
  evidence_json: {
    metricKeys: ['meta_ads_spend', 'meta_ads_platform_roas'],
    sourceIds: ['paid-media:2026-07-25:2026-07-31'],
    windowStart: '2026-07-25',
    windowEnd: '2026-07-31',
    quality: { grade: 'good', issues: [] },
    observedValues: { metaSpend: 78.81, metaRoas: 0.25 },
  },
  proposed_action_json: { type: 'review_meta_channel_performance' },
  proposal_hash: 'proposal-hash-secret-to-planner',
  confidence: 0.75,
  expires_at: '2026-08-07',
  created_at: '2026-08-01',
  updated_at: '2026-08-01',
};

describe('Foresight planner tool registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('fails closed for unknown, disabled, and unexpected arguments', async () => {
    await expect(executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES, name: 'drop_database',
    })).rejects.toThrow('Unknown');
    await expect(executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: [], name: 'get_business_context',
    })).rejects.toThrow('disabled');
    await expect(executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'get_business_context', args: { includeSecrets: true },
    })).rejects.toThrow('Unexpected');
  });

  it('returns compact human-owned business and brand facts without sensitive operational fields', async () => {
    mockBusinessGet.mockResolvedValue({
      business_id: 'business-1', brand_name: 'Monsterthreads', brand_url: 'https://example.com',
      years_in_business: '10', facebook_link: null, instagram_link: null, pinterest_link: null,
      abn: 'must-not-be-returned', updated_at: '2026-08-01T00:00:00Z',
    });
    mockBrandGet.mockResolvedValue({
      business_id: 'business-1', mission: 'Make gifting joyful.', uvp: 'Distinctive gifts.', tone: 'Playful',
      demographics: 'Gift buyers', geo: 'Australia', hero_products: 'Music boxes', price_positioning: 'Mid-market',
      praises: null, objections: null, competitors: null, market_gap: null, logo_url: 'must-not-be-returned',
      brand_colours: 'Red', shipping_policy: 'must-not-be-returned', connected_software: 'must-not-be-returned',
      operations_summary: null, returns_policy: 'must-not-be-returned', brand_history: null,
      detailed_brand_aesthetic: 'Colourful', physical_branches: '[]', loyalty_program: null,
      updated_at: '2026-08-01T00:00:00Z',
    });

    const result = await executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES, name: 'get_business_context',
    });
    const serialized = JSON.stringify(result);

    expect(result.facts).toHaveLength(2);
    expect(result.facts.every((fact) => fact.authority === 'human')).toBe(true);
    expect(serialized).not.toContain('must-not-be-returned');
  });

  it('returns a versioned authoritative strategy fact', async () => {
    mockLatestStrategy.mockResolvedValue({
      id: 4, business_id: 'business-1', version: 2, parent_id: 3,
      strategy_json: {
        schemaVersion: 1, objective: 'profitable_growth', paidMedia: {
          targetMer: 3, minimumContributionPoas: 1, evaluationWindowDays: 7,
          minimumSpend: 100, zeroRevenueSpend: 100, merDeteriorationPercent: 25,
          maximumBudgetReductionPercent: 10, growthMinimumContributionPoas: 3,
          maximumBudgetIncreasePercent: 10, metaMinimumSpend: 25, metaMaximumRoas: 1,
        },
      },
      markdown_text: '# Strategy', authored_by: 7, change_reason: 'Annual review', created_at: '2026-08-01',
    });

    const result = await executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES, name: 'get_marketing_strategy',
    });

    expect(result.facts[0]).toMatchObject({
      factId: 'foresight:strategy:4:v2', authority: 'authoritative',
      value: { version: 2, changeReason: 'Annual review' },
    });
  });

  it('returns bounded tenant-scoped commerce facts and blocks contribution when costs are incomplete', async () => {
    mockGetDailyCommerce.mockResolvedValue([{
      metricDate: '2026-07-01', channel: 'online', salesIncTax: 1100, salesTax: 100,
      returnsIncTax: 110, returnsTax: 10, salesCogs: 400, returnedCogs: 40,
      orderCount: 10, returnCount: 1, costLineCount: 21, missingCostLineCount: 1, costBasis: 'mixed',
    }, {
      metricDate: '2026-07-01', channel: 'pos', salesIncTax: 550, salesTax: 50,
      returnsIncTax: 0, returnsTax: 0, salesCogs: 200, returnedCogs: 0,
      orderCount: 5, returnCount: 0, costLineCount: 5, missingCostLineCount: 0, costBasis: 'estimated',
    }]);

    const result = await executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'get_commerce_performance', args: { from: '2026-07-01', to: '2026-07-31' },
    });

    expect(mockGetDailyCommerce).toHaveBeenCalledWith('business-1', '2026-07-01', '2026-07-31');
    expect(result.facts[0]).toMatchObject({
      authority: 'authoritative', observedFrom: '2026-07-01', observedThrough: '2026-07-31',
      quality: { grade: 'blocked' },
      value: { channels: [
        { channel: 'online', netRevenueExTax: 900, netCogs: null, contributionBeforeMarketing: null },
        { channel: 'pos', netRevenueExTax: 500, netCogs: 200, contributionBeforeMarketing: 300 },
      ] },
    });
  });

  it('rejects invalid and oversized commerce date ranges before IMS access', async () => {
    await expect(executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'get_commerce_performance', args: { from: '2026-02-30', to: '2026-03-01' },
    })).rejects.toThrow('valid calendar dates');
    await expect(executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'get_commerce_performance', args: { from: '2026-01-01', to: '2026-04-01' },
    })).rejects.toThrow('1 to 90 days');
    expect(mockGetDailyCommerce).not.toHaveBeenCalled();
  });

  it('returns selected brand revenue and makes unmatched requested brands explicit', async () => {
    mockListBrandPerformance.mockResolvedValue([{
      brand: 'Legami', quantity: 42, revenue: 1234.567, historyRevenue: 900,
      posRevenue: 134.567, onlineRevenue: 200, wholesaleRevenue: 0, productCount: 8,
    }]);

    const result = await executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'get_brand_performance',
      args: { from: '2026-05-04', to: '2026-08-01', brands: ['Legami', 'Wooderful Life'] },
    });

    expect(mockListBrandPerformance).toHaveBeenCalledWith(
      'business-1', '2026-05-04', '2026-08-01', ['Legami', 'Wooderful Life'], 2,
    );
    expect(result.facts[0]).toMatchObject({
      observedFrom: '2026-05-04', observedThrough: '2026-08-01',
      quality: { grade: 'partial', issues: [{ code: 'unmatched_brand_names' }] },
      value: {
        revenueBasis: 'tax_inclusive_before_returns',
        matchedBrands: ['Legami'], unmatchedBrands: ['Wooderful Life'],
        brands: [{ brand: 'Legami', revenue: 1234.57, posRevenue: 134.57 }],
      },
    });
  });

  it('rejects unbounded brand requests before IMS access', async () => {
    await expect(executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'get_brand_performance',
      args: { from: '2026-07-01', to: '2026-08-01', brands: Array.from({ length: 11 }, (_, index) => `Brand ${index}`) },
    })).rejects.toThrow('1 to 10');
    expect(mockListBrandPerformance).not.toHaveBeenCalled();
  });

  it('returns bounded inventory signals with tax-exclusive unit margin', async () => {
    mockListProductPlanningRows.mockResolvedValue([{
      variantId: 'variant-excess', sku: 'EXCESS-1', productName: 'Slow Gift', variantLabel: 'Default',
      brand: 'Example', productType: 'Gifts', isOnline: true, priceIncTax: 55, averageCostExTax: 20,
      salesQuantity90Days: 0, stockOnHand: 30, stockAvailable: 30, stockIncoming: 0,
      cacheUpdatedAt: '2026-08-01 09:00:00',
    }, {
      variantId: 'variant-risk', sku: 'RISK-1', productName: 'Fast Gift', variantLabel: 'Red',
      brand: 'Example', productType: 'Gifts', isOnline: true, priceIncTax: 44, averageCostExTax: 15,
      salesQuantity90Days: 90, stockOnHand: 10, stockAvailable: 10, stockIncoming: 5,
      cacheUpdatedAt: '2026-08-01 09:00:00',
    }]);

    const result = await executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'get_product_inventory_signals', args: { limit: 2 },
    });

    expect(mockListProductPlanningRows).toHaveBeenCalledWith('business-1', 2);
    expect(result.facts).toHaveLength(2);
    expect(result.facts[0]).toMatchObject({
      observedFrom: '2026-05-04', observedThrough: '2026-08-01', quality: { grade: 'good' },
      value: { signal: 'excess_stock', unitGrossMarginExTax: 30 },
    });
    expect(result.facts[1]).toMatchObject({
      label: 'Fast Gift / Red', value: { signal: 'stockout_risk', daysIncludingIncoming: 15, unitGrossMarginExTax: 25 },
    });
  });

  it('returns bounded inbound timing facts and flags missing expected dates', async () => {
    mockListOpenInbound.mockResolvedValue([{
      purchaseOrderId: 19, purchaseOrderNumber: 'PO-0019', status: 'confirmed', orderDate: '2026-07-20',
      expectedDate: '2026-08-10', supplierName: 'Supplier', variantId: 'variant-1', sku: 'SKU-1',
      productName: 'Music Box', variantLabel: 'Blue', quantityOrdered: 12, quantityReceived: 5,
      quantityOutstanding: 7, updatedAt: '2026-08-01 10:00:00',
    }, {
      purchaseOrderId: 20, purchaseOrderNumber: 'PO-0020', status: 'partially_received', orderDate: '2026-07-25',
      expectedDate: null, supplierName: 'Supplier', variantId: 'variant-2', sku: 'SKU-2',
      productName: 'Clock', variantLabel: 'Default', quantityOrdered: 10, quantityReceived: 2,
      quantityOutstanding: 8, updatedAt: '2026-08-01 10:30:00',
    }]);

    const result = await executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'get_open_inbound_stock', args: { limit: 2 },
    });

    expect(mockListOpenInbound).toHaveBeenCalledWith('business-1', 2);
    expect(result.facts[0]).toMatchObject({
      label: 'PO-0019: Music Box / Blue', quality: { grade: 'good' },
      value: { quantityOutstanding: 7, daysUntilExpected: 9, timing: 'due_soon' },
    });
    expect(result.facts[1]).toMatchObject({
      quality: { grade: 'partial', issues: [{ code: 'missing_expected_delivery_date' }] },
      value: { timing: 'unknown' },
    });
  });

  it('bounds recommendation results, preserves quality, and excludes proposal hashes', async () => {
    mockListRecommendations.mockResolvedValue([recommendation, { ...recommendation, id: 21 }]);

    const result = await executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'list_recommendations', args: { states: ['shadow'], limit: 1 },
    });

    expect(mockListRecommendations).toHaveBeenCalledWith('business-1', ['shadow']);
    expect(result).toMatchObject({ truncated: true, facts: [{ authority: 'diagnostic', quality: { grade: 'good' } }] });
    expect(JSON.stringify(result)).not.toContain('proposal-hash-secret-to-planner');
  });

  it('requires a positive recommendation ID and uses tenant-scoped repository access', async () => {
    await expect(executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'get_recommendation', args: { recommendationId: 0 },
    })).rejects.toThrow('positive integer');

    mockGetRecommendation.mockResolvedValue(recommendation);
    const result = await executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'get_recommendation', args: { recommendationId: 20 },
    });

    expect(mockGetRecommendation).toHaveBeenCalledWith('business-1', 20);
    expect(result.facts[0].factId).toContain('foresight:recommendation:20');
  });

  it('returns bounded audited campaign outcomes with authoritative commerce separate from diagnostics', async () => {
    mockListLearningOutcomes.mockResolvedValue([{
      id: 93, business_id: 'business-1', activation_id: 91, thread_id: 12,
      deliverable_version_id: 80, document_hash: 'b'.repeat(64), horizon_days: 7,
      baseline_start: '2026-07-17', baseline_end: '2026-07-23',
      followup_start: '2026-07-25', followup_end: '2026-07-31', direction: 'improved',
      primary_metric: 'contribution_before_ads', baseline_value: 700, followup_value: 840,
      activated_on: '2026-07-24', channels_json: [{ channel: 'meta', campaignId: 'campaign-1', adSetId: null, flowId: null }],
      asset_ids_json: ['meta-primary'], published_details: 'Published.', deviations_text: null,
      deliverable_document_json: { productSelection: [{ name: 'Legami', rationale: 'Demand.', citationFactIds: ['fact-1'] }] },
      assessment_json: {
        explanation: 'Observed improvement without causal inference.',
        baseline: { onlineRevenueExTax: 1400, contributionBeforeAds: 700, paidMediaSpend: 350, mer: 4, contributionPoas: 2 },
        followup: { onlineRevenueExTax: 1600, contributionBeforeAds: 840, paidMediaSpend: 400, mer: 4, contributionPoas: 2.1 },
      },
      created_at: '2026-08-01',
    }]);

    const result = await executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'list_campaign_outcomes',
      args: { from: '2026-05-01', to: '2026-08-01', channel: 'meta', product: 'legami', direction: 'improved', limit: 10 },
    });

    expect(mockListLearningOutcomes).toHaveBeenCalledWith('business-1', {
      from: '2026-05-01', to: '2026-08-01', direction: 'improved', limit: 50,
    });
    expect(result).toMatchObject({
      tool: 'list_campaign_outcomes', manifestVersion: 'foresight-planner-tools-v6', truncated: false,
      facts: [{
        factId: 'foresight:campaign-outcome:93:activation:91', authority: 'authoritative',
        observedFrom: '2026-07-17', observedThrough: '2026-07-31',
        value: {
          products: ['Legami'], direction: 'improved',
          authoritativeCommerce: { baseline: { onlineRevenueExTax: 1400 }, followup: { contributionBeforeAds: 840 } },
          diagnosticMediaRatios: { baselineSpend: 350, followupMer: 4 },
          interpretation: expect.stringContaining('does not establish'),
        },
      }],
    });
  });

  it('returns only repository-confirmed human-accepted campaign lessons as advisory facts', async () => {
    mockListAcceptedLessons.mockResolvedValue([{ id: 44, business_id: 'business-1', thread_id: 12,
      outcome_id: 31, activation_id: 22, version: 1, parent_id: null, schema_version: 1,
      lesson_hash: 'a'.repeat(64), model_id: 'gemini-2.5-flash', prompt_version: 'campaign-learning-v1',
      authored_by: 7, change_reason: null, created_at: '2026-08-03', accepted_at: '2026-08-04',
      accepted_by: 8, review_note: null, lesson_json: { title: 'Keep testing the offer',
        observations: [{ text: 'Contribution improved.', citationFactIds: ['foresight:campaign-outcome:31:activation:22'] }],
        limitations: ['This comparison is observational.'],
        hypotheses: [{ text: 'The offer may matter.', status: 'requires_human_validation', validationApproach: 'Repeat a controlled test.' }],
        suggestedApplications: [{ text: 'Consider a follow-up test.', executable: false }] } }]);

    const result = await executeForesightPlannerTool({ businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'list_accepted_campaign_lessons', args: { from: '2026-08-01', to: '2026-08-31', limit: 10 } });

    expect(mockListAcceptedLessons).toHaveBeenCalledWith('business-1', { from: '2026-08-01', to: '2026-08-31', limit: 11 });
    expect(result).toMatchObject({ tool: 'list_accepted_campaign_lessons', manifestVersion: 'foresight-planner-tools-v6',
      facts: [{ factId: 'foresight:campaign-lesson:44:v1', authority: 'human', value: {
        outcomeId: 31, suggestedApplications: [{ executable: false }] } }] });
    expect(JSON.stringify(result)).toContain('does not authorize strategy');
  });

  it('returns exact human-acknowledged experiment conclusions as non-authorizing evidence', async () => {
    mockListAcceptedExperimentConclusions.mockResolvedValue([{ id: 77, business_id: 'business-1', thread_id: 12,
      experiment_version_id: 55, experiment_hash: 'c'.repeat(64), launch_id: 66,
      formula_version: 'foresight-experiment-evaluator-v1', status: 'treatment_won', primary_metric: 'conversion_rate',
      control_value: 0.05, treatment_value: 0.09, p_value: 0.0004, evaluated_by: 0, created_at: '2026-08-17', acknowledged_at: '2026-08-18',
      observation_json: { source: 'verified_klaviyo_export', observedFrom: '2026-08-10', observedThrough: '2026-08-16', qualityIssues: [],
        control: { sampleSize: 1000, conversions: 50, guardrailEvents: { unsubscribe_rate: 10 } },
        treatment: { sampleSize: 1000, conversions: 90, guardrailEvents: { unsubscribe_rate: 11 } } },
      assessment_json: { status: 'treatment_won', primaryMetric: 'conversion_rate', controlValue: 0.05, treatmentValue: 0.09,
        absoluteDifference: 0.04, relativeLiftPercent: 80,
        test: { method: 'two_proportion_z', statistic: 3.5, degreesOfFreedom: null, pValue: 0.0004, confidenceLevel: 0.95 },
        sample: { control: 1000, treatment: 1000, minimumPerVariant: 500, sufficient: true }, qualityIssues: [],
        guardrails: [{ metric: 'unsubscribe_rate', controlRate: 0.01, treatmentRate: 0.011, adverseChangePercent: 10,
          maximumAdverseChangePercent: 20, passed: true }],
        explanation: 'Treatment performed better under the predeclared test.' } }]);

    const result = await executeForesightPlannerTool({ businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'list_experiment_conclusions', args: { from: '2026-08-01', to: '2026-08-31', status: 'treatment_won', limit: 10 } });

    expect(mockListAcceptedExperimentConclusions).toHaveBeenCalledWith('business-1',
      { from: '2026-08-01', to: '2026-08-31', limit: 26 });
    expect(result).toMatchObject({ tool: 'list_experiment_conclusions', manifestVersion: 'foresight-planner-tools-v6',
      facts: [{ factId: 'foresight:experiment-result:77:launch:66', authority: 'human',
        observedFrom: '2026-08-10', observedThrough: '2026-08-16', value: {
          status: 'treatment_won', pValue: 0.0004, relativeLiftPercent: 80, confidenceLevel: 0.95 } }] });
    expect(JSON.stringify(result)).toContain('does not authorize strategy');
  });

  it('rejects unsupported experiment conclusion statuses before repository access', async () => {
    await expect(executeForesightPlannerTool({ businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'list_experiment_conclusions', args: { from: '2026-08-01', to: '2026-08-31', status: 'approved' } }))
      .rejects.toThrow('Unsupported experiment conclusion status');
    expect(mockListAcceptedExperimentConclusions).not.toHaveBeenCalled();
  });

  it('returns only exact human-accepted creative briefs as non-publishing planning evidence', async () => {
    mockListAcceptedCreativeBriefs.mockResolvedValue([{ id: 80, business_id: 'business-1', thread_id: 12,
      creative_id: 44, creative_name: 'Gift ad', creative_source: 'meta_ads', assessment_id: 9,
      diagnostics_through: '2026-08-01', version: 2, parent_id: 79, schema_version: 1,
      document_hash: 'd'.repeat(64), model_id: 'gemini-2.5-flash', prompt_version: 'creative-brief-v1',
      prompt_hash: 'e'.repeat(64), authored_by: 7, change_reason: 'Proof revision', created_at: '2026-08-02',
      accepted_at: '2026-08-03', accepted_by: 8, review_note: null, markdown_text: '# Brief', document_json: {
        title: 'Gift confidence refresh', audience: 'Returning gift buyers', hypothesis: 'Clear proof may improve engagement.',
        singleMindedProposition: 'Choose a thoughtful gift confidently.', proofPoints: ['Free wrapping'], tone: ['Warm'],
        formats: [{ format: '4:5 image', placement: 'Meta feed', adaptationNotes: 'Keep proof visible.' }],
        variants: [{ id: 'proof', change: 'Lead with wrapping', rationale: 'Test confidence cue.' }],
        exclusions: ['No urgency'], successMetric: 'Platform CTR', stockOfferConstraints: ['Confirm stock'],
        uncertainties: ['No causal result exists yet'],
      } }]);

    const result = await executeForesightPlannerTool({ businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'list_accepted_creative_briefs', args: { from: '2026-08-01', to: '2026-08-31', limit: 10 } });

    expect(mockListAcceptedCreativeBriefs).toHaveBeenCalledWith('business-1',
      { from: '2026-08-01', to: '2026-08-31', limit: 11 });
    expect(result).toMatchObject({ tool: 'list_accepted_creative_briefs', manifestVersion: 'foresight-planner-tools-v6',
      facts: [{ factId: 'foresight:creative-brief:80:v2', authority: 'human', observedThrough: '2026-08-01',
        value: { creativeId: 44, hypothesis: 'Clear proof may improve engagement.', successMetric: 'Platform CTR' } }] });
    expect(JSON.stringify(result)).toContain('does not authorize publication');
  });

  it('rejects unbounded or unsupported campaign outcome filters before repository access', async () => {
    await expect(executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'list_campaign_outcomes', args: { from: '2025-01-01', to: '2026-08-01' },
    })).rejects.toThrow('1 to 366 days');
    await expect(executeForesightPlannerTool({
      businessId: 'business-1', enabledTools: FORESIGHT_PLANNER_TOOL_NAMES,
      name: 'list_campaign_outcomes', args: { from: '2026-07-01', to: '2026-08-01', channel: 'tiktok' },
    })).rejects.toThrow('Unsupported campaign channel');
    expect(mockListLearningOutcomes).not.toHaveBeenCalled();
  });
});