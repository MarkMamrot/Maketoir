import { createHash } from 'node:crypto';

export const FORESIGHT_DELIVERABLE_SCHEMA_VERSION = 1;

export type DeliverableChannel = 'campaign_brief' | 'meta' | 'google_ads' | 'klaviyo';

export interface DeliverableClaim {
  text: string;
  citationFactIds: string[];
}

export interface DeliverableAsset {
  id: string;
  channel: DeliverableChannel;
  assetType: string;
  title: string;
  content: string;
  publishable: false;
  claims: DeliverableClaim[];
  reviewNotes: string[];
}

export interface ForesightDeliverableDocument {
  schemaVersion: 1;
  title: string;
  planVersionId: number;
  planHash: string;
  objective: string;
  audience: string[];
  productSelection: Array<{
    name: string;
    rationale: string;
    citationFactIds: string[];
  }>;
  offerConstraints: string[];
  creativeDirection: string[];
  assets: DeliverableAsset[];
  trackingRequirements: string[];
  successMetrics: string[];
  guardrails: string[];
  reviewDate: string | null;
  stopConditions: string[];
}

export class ForesightDeliverableValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super('Invalid Foresight deliverable document.');
    this.name = 'ForesightDeliverableValidationError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push(`${path} must be a non-empty string.`);
    return '';
  }
  return value.trim();
}

function stringArray(value: unknown, path: string, issues: string[]): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array.`);
    return [];
  }
  return value.map((item, index) => text(item, `${path}[${index}]`, issues));
}

function citedIds(value: unknown, path: string, knownFactIds: Set<string>, issues: string[]): string[] {
  const ids = stringArray(value, path, issues);
  for (const id of ids) {
    if (!knownFactIds.has(id)) issues.push(`${path} references unknown accepted-plan fact ${id}.`);
  }
  return ids;
}

export function parseForesightDeliverableDocument(
  value: unknown,
  expected: { planVersionId: number; planHash: string; knownFactIds: Iterable<string> },
): ForesightDeliverableDocument {
  const issues: string[] = [];
  const input = record(value);
  if (!input) throw new ForesightDeliverableValidationError(['deliverable must be an object.']);
  const knownFactIds = new Set(expected.knownFactIds);
  if (input.schemaVersion !== FORESIGHT_DELIVERABLE_SCHEMA_VERSION) issues.push('schemaVersion must be 1.');
  if (input.planVersionId !== expected.planVersionId) issues.push('planVersionId must match the accepted plan.');
  if (input.planHash !== expected.planHash) issues.push('planHash must match the accepted plan.');
  const productSelection = Array.isArray(input.productSelection) ? input.productSelection.map((value, index) => {
    const item = record(value) ?? {};
    if (!record(value)) issues.push(`productSelection[${index}] must be an object.`);
    return {
      name: text(item.name, `productSelection[${index}].name`, issues),
      rationale: text(item.rationale, `productSelection[${index}].rationale`, issues),
      citationFactIds: citedIds(item.citationFactIds, `productSelection[${index}].citationFactIds`, knownFactIds, issues),
    };
  }) : (issues.push('productSelection must be an array.'), []);
  const assets = Array.isArray(input.assets) ? input.assets.map((value, index) => {
    const item = record(value) ?? {};
    if (!record(value)) issues.push(`assets[${index}] must be an object.`);
    const channel = item.channel;
    if (!['campaign_brief', 'meta', 'google_ads', 'klaviyo'].includes(String(channel))) {
      issues.push(`assets[${index}].channel is invalid.`);
    }
    if (item.publishable !== false) issues.push(`assets[${index}].publishable must be false.`);
    const claims = Array.isArray(item.claims) ? item.claims.map((claimValue, claimIndex) => {
      const claim = record(claimValue) ?? {};
      if (!record(claimValue)) issues.push(`assets[${index}].claims[${claimIndex}] must be an object.`);
      const citationFactIds = citedIds(
        claim.citationFactIds,
        `assets[${index}].claims[${claimIndex}].citationFactIds`,
        knownFactIds,
        issues,
      );
      if (citationFactIds.length === 0) issues.push(`assets[${index}].claims[${claimIndex}] requires a citation.`);
      return { text: text(claim.text, `assets[${index}].claims[${claimIndex}].text`, issues), citationFactIds };
    }) : (issues.push(`assets[${index}].claims must be an array.`), []);
    return {
      id: text(item.id, `assets[${index}].id`, issues),
      channel: channel as DeliverableChannel,
      assetType: text(item.assetType, `assets[${index}].assetType`, issues),
      title: text(item.title, `assets[${index}].title`, issues),
      content: text(item.content, `assets[${index}].content`, issues),
      publishable: false as const,
      claims,
      reviewNotes: stringArray(item.reviewNotes, `assets[${index}].reviewNotes`, issues),
    };
  }) : (issues.push('assets must be an array.'), []);
  if (assets.length === 0) issues.push('assets must contain at least one draft asset.');
  const reviewDate = input.reviewDate == null ? null : text(input.reviewDate, 'reviewDate', issues);
  const document: ForesightDeliverableDocument = {
    schemaVersion: 1,
    title: text(input.title, 'title', issues),
    planVersionId: expected.planVersionId,
    planHash: expected.planHash,
    objective: text(input.objective, 'objective', issues),
    audience: stringArray(input.audience, 'audience', issues),
    productSelection,
    offerConstraints: stringArray(input.offerConstraints, 'offerConstraints', issues),
    creativeDirection: stringArray(input.creativeDirection, 'creativeDirection', issues),
    assets,
    trackingRequirements: stringArray(input.trackingRequirements, 'trackingRequirements', issues),
    successMetrics: stringArray(input.successMetrics, 'successMetrics', issues),
    guardrails: stringArray(input.guardrails, 'guardrails', issues),
    reviewDate,
    stopConditions: stringArray(input.stopConditions, 'stopConditions', issues),
  };
  if (issues.length > 0) throw new ForesightDeliverableValidationError(issues);
  return document;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

export function hashForesightDeliverable(document: ForesightDeliverableDocument): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(document))).digest('hex');
}

export function renderForesightDeliverableMarkdown(document: ForesightDeliverableDocument): string {
  return [
    `# ${document.title}`,
    '',
    `**Objective:** ${document.objective}`,
    `**Accepted plan:** ${document.planVersionId} (${document.planHash})`,
    '',
    '## Audience',
    ...document.audience.map((item) => `- ${item}`),
    '',
    '## Product Selection',
    ...document.productSelection.map((item) => `- **${item.name}:** ${item.rationale} [${item.citationFactIds.join(', ')}]`),
    '',
    '## Draft Assets',
    ...document.assets.flatMap((asset) => [
      `### ${asset.title} (${asset.channel} / ${asset.assetType})`,
      '',
      asset.content,
      '',
      '**Human review required. This asset is not publishable from Foresight.**',
      '',
    ]),
    '## Tracking Requirements',
    ...document.trackingRequirements.map((item) => `- ${item}`),
    '',
    '## Success Metrics',
    ...document.successMetrics.map((item) => `- ${item}`),
    '',
    '## Guardrails',
    ...document.guardrails.map((item) => `- ${item}`),
    '',
    '## Stop Conditions',
    ...document.stopConditions.map((item) => `- ${item}`),
    '',
  ].join('\n');
}