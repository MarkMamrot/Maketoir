import { createHash } from 'node:crypto';

export interface CreativeReviewHumanContext {
  intendedAudience: string;
  intendedMessage: string;
  offer: string;
  offlineContext: string;
}

export interface CreativeBriefDocument {
  schemaVersion: 1;
  creativeId: number;
  assessmentId: number;
  diagnosticsThrough: string;
  title: string;
  hypothesis: string;
  audience: string;
  singleMindedProposition: string;
  proofPoints: string[];
  tone: string[];
  formats: Array<{ format: string; placement: string; adaptationNotes: string }>;
  variants: Array<{ id: string; change: string; rationale: string }>;
  testMatrix: Array<{ variantId: string; comparison: string; primaryMetric: string; guardrails: string[] }>;
  exclusions: string[];
  successMetric: string;
  stockOfferConstraints: string[];
  uncertainties: string[];
  humanContext: CreativeReviewHumanContext;
  publishable: false;
}

export class CreativeBriefValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join(' '));
    this.name = 'CreativeBriefValidationError';
  }
}

function object(value: unknown, path: string, issues: string[]): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(`${path} must be an object.`);
    return {};
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, issues: string[], maximum = 1_000): string {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push(`${path} must be a non-empty string.`);
    return '';
  }
  const result = value.trim();
  if (result.length > maximum) issues.push(`${path} must be at most ${maximum} characters.`);
  return result;
}

function list(value: unknown, path: string, issues: string[], minimum = 0, maximum = 20): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array.`);
    return [];
  }
  if (value.length < minimum || value.length > maximum) issues.push(`${path} must contain between ${minimum} and ${maximum} items.`);
  const result = value.slice(0, maximum).map((item, index) => text(item, `${path}[${index}]`, issues, 500));
  if (new Set(result.map((item) => item.toLowerCase())).size !== result.length) issues.push(`${path} must not contain duplicates.`);
  return result;
}

export function parseCreativeReviewHumanContext(value: unknown): CreativeReviewHumanContext {
  const issues: string[] = [];
  const input = object(value, 'humanContext', issues);
  const allowed = new Set(['intendedAudience', 'intendedMessage', 'offer', 'offlineContext']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) issues.push(`humanContext.${key} is not allowed.`);
  const context = {
    intendedAudience: text(input.intendedAudience, 'humanContext.intendedAudience', issues, 1_000),
    intendedMessage: text(input.intendedMessage, 'humanContext.intendedMessage', issues, 1_000),
    offer: text(input.offer, 'humanContext.offer', issues, 1_000),
    offlineContext: text(input.offlineContext, 'humanContext.offlineContext', issues, 2_000),
  };
  if (issues.length) throw new CreativeBriefValidationError(issues);
  return context;
}

export function parseCreativeBriefDocument(value: unknown, expected: {
  creativeId: number; assessmentId: number; diagnosticsThrough: string; humanContext: CreativeReviewHumanContext;
}): CreativeBriefDocument {
  const issues: string[] = [];
  const input = object(value, 'brief', issues);
  const allowed = new Set(['schemaVersion', 'creativeId', 'assessmentId', 'diagnosticsThrough', 'title', 'hypothesis',
    'audience', 'singleMindedProposition', 'proofPoints', 'tone', 'formats', 'variants', 'testMatrix', 'exclusions',
    'successMetric', 'stockOfferConstraints', 'uncertainties', 'humanContext', 'publishable']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) issues.push(`brief.${key} is not allowed.`);
  if (input.schemaVersion !== 1) issues.push('brief.schemaVersion must be 1.');
  if (input.creativeId !== expected.creativeId) issues.push('brief.creativeId must match the reviewed creative.');
  if (input.assessmentId !== expected.assessmentId) issues.push('brief.assessmentId must match the latest assessment.');
  if (input.diagnosticsThrough !== expected.diagnosticsThrough) issues.push('brief.diagnosticsThrough must match the diagnostic snapshot.');
  if (input.publishable !== false) issues.push('brief.publishable must be false.');
  const humanContext = parseCreativeReviewHumanContext(input.humanContext);
  if (JSON.stringify(humanContext) !== JSON.stringify(expected.humanContext)) issues.push('brief.humanContext must preserve the recorded human context exactly.');
  const formats = Array.isArray(input.formats) ? input.formats.slice(0, 10).map((value, index) => {
    const item = object(value, `brief.formats[${index}]`, issues);
    return { format: text(item.format, `brief.formats[${index}].format`, issues, 100),
      placement: text(item.placement, `brief.formats[${index}].placement`, issues, 100),
      adaptationNotes: text(item.adaptationNotes, `brief.formats[${index}].adaptationNotes`, issues, 500) };
  }) : (issues.push('brief.formats must be an array.'), []);
  if (formats.length === 0) issues.push('brief.formats must contain at least one format.');
  const variants = Array.isArray(input.variants) ? input.variants.slice(0, 10).map((value, index) => {
    const item = object(value, `brief.variants[${index}]`, issues);
    return { id: text(item.id, `brief.variants[${index}].id`, issues, 100),
      change: text(item.change, `brief.variants[${index}].change`, issues, 500),
      rationale: text(item.rationale, `brief.variants[${index}].rationale`, issues, 500) };
  }) : (issues.push('brief.variants must be an array.'), []);
  if (variants.length < 2) issues.push('brief.variants must contain at least two variants.');
  const variantIds = new Set(variants.map((item) => item.id));
  if (variantIds.size !== variants.length) issues.push('brief.variants ids must be unique.');
  const testMatrix = Array.isArray(input.testMatrix) ? input.testMatrix.slice(0, 10).map((value, index) => {
    const item = object(value, `brief.testMatrix[${index}]`, issues);
    const variantId = text(item.variantId, `brief.testMatrix[${index}].variantId`, issues, 100);
    if (!variantIds.has(variantId)) issues.push(`brief.testMatrix[${index}].variantId must reference a declared variant.`);
    return { variantId, comparison: text(item.comparison, `brief.testMatrix[${index}].comparison`, issues, 500),
      primaryMetric: text(item.primaryMetric, `brief.testMatrix[${index}].primaryMetric`, issues, 200),
      guardrails: list(item.guardrails, `brief.testMatrix[${index}].guardrails`, issues, 1, 10) };
  }) : (issues.push('brief.testMatrix must be an array.'), []);
  if (testMatrix.length < 2) issues.push('brief.testMatrix must contain at least two rows.');
  const document: CreativeBriefDocument = {
    schemaVersion: 1, creativeId: expected.creativeId, assessmentId: expected.assessmentId,
    diagnosticsThrough: expected.diagnosticsThrough, title: text(input.title, 'brief.title', issues, 200),
    hypothesis: text(input.hypothesis, 'brief.hypothesis', issues, 1_000), audience: text(input.audience, 'brief.audience', issues, 1_000),
    singleMindedProposition: text(input.singleMindedProposition, 'brief.singleMindedProposition', issues, 500),
    proofPoints: list(input.proofPoints, 'brief.proofPoints', issues, 1), tone: list(input.tone, 'brief.tone', issues, 1),
    formats, variants, testMatrix, exclusions: list(input.exclusions, 'brief.exclusions', issues, 1),
    successMetric: text(input.successMetric, 'brief.successMetric', issues, 300),
    stockOfferConstraints: list(input.stockOfferConstraints, 'brief.stockOfferConstraints', issues, 1),
    uncertainties: list(input.uncertainties, 'brief.uncertainties', issues, 1), humanContext, publishable: false,
  };
  if (issues.length) throw new CreativeBriefValidationError(issues);
  return document;
}

export function hashCreativeBrief(document: CreativeBriefDocument): string {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
}

export function renderCreativeBriefMarkdown(document: CreativeBriefDocument): string {
  return [`# ${document.title}`, '', `**Hypothesis:** ${document.hypothesis}`, '', `**Audience:** ${document.audience}`,
    '', `**Single-minded proposition:** ${document.singleMindedProposition}`, '', '## Proof',
    ...document.proofPoints.map((item) => `- ${item}`), '', '## Formats',
    ...document.formats.map((item) => `- **${item.format} / ${item.placement}:** ${item.adaptationNotes}`), '',
    '## Variants', ...document.variants.map((item) => `- **${item.id}:** ${item.change} — ${item.rationale}`), '',
    '## Test matrix', ...document.testMatrix.map((item) => `- **${item.variantId}:** ${item.comparison}; primary metric: ${item.primaryMetric}; guardrails: ${item.guardrails.join(', ')}`),
    '', '## Exclusions', ...document.exclusions.map((item) => `- ${item}`), '', '## Stock and offer constraints',
    ...document.stockOfferConstraints.map((item) => `- ${item}`), '', '## Uncertainty', ...document.uncertainties.map((item) => `- ${item}`),
    '', '> Draft only. This brief is not publishable and does not authorize platform changes.'].join('\n');
}
