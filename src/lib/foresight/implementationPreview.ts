import type { ForesightChannel } from './types';

export interface RecommendationImplementationPreview {
  mode: 'manual_external';
  executable: false;
  title: string;
  summary: string;
  steps: string[];
  guardrails: string[];
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function buildRecommendationImplementationPreview(
  channel: ForesightChannel,
  proposedAction: Record<string, unknown> | null,
): RecommendationImplementationPreview {
  const actionType = String(proposedAction?.type ?? 'manual_review');
  const commonGuardrails = [
    'Make changes in the external platform only after checking the current live configuration.',
    'Record what was actually changed; approval alone does not count as implementation.',
  ];

  if (actionType === 'investigate_measurement_and_spend') {
    return {
      mode: 'manual_external',
      executable: false,
      title: 'Measurement and spend investigation',
      summary: 'Verify authoritative revenue capture and paid-media delivery before changing budgets.',
      steps: [
        'Compare Google and Meta spend against the same-date authoritative online order ledger.',
        'Check conversion tags, platform account selection, campaign delivery, and recent site or checkout changes.',
        'Correct confirmed measurement issues or record any manual campaign changes in the implementation note.',
      ],
      guardrails: [
        ...commonGuardrails,
        'Do not reduce spend solely because authoritative commerce ingestion is delayed or incomplete.',
      ],
    };
  }

  if (actionType === 'review_budget_reduction') {
    const maximumReductionPercent = number(proposedAction?.maximumReductionPercent);
    const cap = maximumReductionPercent == null ? 'the approved business guardrail' : `${maximumReductionPercent}%`;
    return {
      mode: 'manual_external',
      executable: false,
      title: 'Capped budget-reduction review',
      summary: `Review underperforming paid-media budgets without reducing any reviewed budget by more than ${cap}.`,
      steps: [
        'Inspect the named campaign and ad-set contributors in each advertising platform.',
        `Choose any manual budget reductions, capped at ${cap} for each reviewed budget.`,
        'Record the platforms, campaign or ad-set names, previous budgets, and new budgets in the implementation note.',
      ],
      guardrails: [
        ...commonGuardrails,
        `No reviewed budget reduction may exceed ${cap}.`,
        'Do not treat platform-attributed revenue as authoritative retail revenue.',
      ],
    };
  }

  if (actionType === 'review_capped_budget_increase') {
    const maximumIncreasePercent = number(proposedAction?.maximumIncreasePercent);
    const cap = maximumIncreasePercent == null ? 'the approved business guardrail' : `${maximumIncreasePercent}%`;
    return {
      mode: 'manual_external',
      executable: false,
      title: 'Capped profitable-growth review',
      summary: `Review sustained strong performance before increasing any selected budget by no more than ${cap}.`,
      steps: [
        'Inspect the named stable campaign contributors and confirm their current live delivery and budget constraints.',
        `Choose budget increases capped at ${cap} for each reviewed budget; eligible Google campaigns can use guarded in-app execution.`,
        'For unsupported platforms or campaigns, record the platform, campaign names, previous budgets, new budgets, and implementation date.',
      ],
      guardrails: [
        ...commonGuardrails,
        `No reviewed budget increase may exceed ${cap}.`,
        'Do not increase a campaign with a current tracking issue, material ROAS deterioration beyond the configured tolerance, shared budget, or incomplete financial evidence.',
        'Platform attribution is diagnostic; the portfolio contribution and MER gates remain authoritative.',
      ],
    };
  }

  if (actionType === 'review_channel_and_campaign_mix') {
    return {
      mode: 'manual_external',
      executable: false,
      title: 'Channel and campaign mix review',
      summary: 'Review the diagnosed contributors and decide whether targeting, creative, allocation, or measurement needs intervention.',
      steps: [
        'Open the named Google and Meta contributors and compare current delivery with the evidence window.',
        'Review targeting, creative fatigue, placement, bidding, budget allocation, and conversion tracking.',
        'Apply only the changes supported by the live account review and document each actual change.',
      ],
      guardrails: [
        ...commonGuardrails,
        'Contributor ranking is diagnostic and does not allocate authoritative backend revenue to campaigns.',
      ],
    };
  }

  if (actionType === 'review_klaviyo_lifecycle_flows') {
    const missing = Array.isArray(proposedAction?.missingCategories)
      ? proposedAction.missingCategories.map(String)
      : [];
    const inactive = Array.isArray(proposedAction?.inactiveCategories)
      ? proposedAction.inactiveCategories.map(String)
      : [];
    return {
      mode: 'manual_external',
      executable: false,
      title: 'Klaviyo lifecycle-flow review',
      summary: 'Review missing and inactive lifecycle coverage in Klaviyo before creating or activating flows.',
      steps: [
        ...(missing.length > 0 ? [`Review missing categories: ${missing.join(', ')}.`] : []),
        ...(inactive.length > 0 ? [`Review inactive categories: ${inactive.join(', ')}.`] : []),
        'Confirm triggers, filters, consent rules, message timing, suppression logic, and test recipients in Klaviyo.',
        'Create or activate only the validated flows and record their names in the implementation note.',
      ],
      guardrails: [
        ...commonGuardrails,
        'Do not activate a flow until test messages and audience exclusions have been verified.',
        'Lifecycle coverage does not prove incremental or attributed revenue.',
      ],
    };
  }

  if (actionType === 'investigate_ga4_channel_funnel') {
    const channelName = String(proposedAction?.channel ?? 'the affected channel');
    return {
      mode: 'manual_external',
      executable: false,
      title: `${channelName} funnel investigation`,
      summary: 'Investigate the material GA4 conversion-rate decline before changing acquisition spend.',
      steps: [
        `Compare ${channelName} landing pages, devices, source/medium values, and campaign traffic across the two evidence windows.`,
        'Check consent mode, conversion event definitions, checkout behavior, page speed, broken links, and recent merchandising changes.',
        'Record confirmed causes and any external analytics, site, or campaign changes in the implementation note.',
      ],
      guardrails: [
        ...commonGuardrails,
        'GA4 conversions are diagnostic and must not replace authoritative commerce revenue.',
        'Do not change budgets solely from this funnel signal without reviewing complete financial evidence.',
      ],
    };
  }

  return {
    mode: 'manual_external',
    executable: false,
    title: `${channel.replaceAll('_', ' ')} manual review`,
    summary: 'The proposal does not contain enough structured detail to preview a specific external change.',
    steps: [
      'Review the current live platform configuration against the recommendation evidence.',
      'Apply only changes that are independently validated and record the exact implementation details.',
    ],
    guardrails: commonGuardrails,
  };
}