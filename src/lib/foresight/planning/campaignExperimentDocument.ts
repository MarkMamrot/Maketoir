import { createHash } from 'node:crypto';

export const FORESIGHT_CAMPAIGN_EXPERIMENT_SCHEMA_VERSION = 1;
export type CampaignExperimentMetric = 'conversion_rate' | 'revenue_per_session' | 'contribution_per_session';

export interface ForesightCampaignExperimentDocument {
  schemaVersion: 1;
  lessonVersionId: number;
  lessonHash: string;
  title: string;
  hypothesis: { text: string; citationFactIds: string[] };
  channel: 'meta' | 'google_ads' | 'klaviyo';
  audience: string;
  control: { name: string; description: string };
  treatment: { name: string; description: string };
  allocationPercent: { control: number; treatment: number };
  startDate: string;
  endDate: string;
  minimumSamplePerVariant: number;
  primaryMetric: CampaignExperimentMetric;
  minimumDetectableLiftPercent: number;
  guardrails: Array<{ metric: string; maximumAdverseChangePercent: number }>;
  analysis: { method: 'frequentist_two_sided'; confidenceLevel: 0.95; inconclusiveWhenUnderpowered: true };
  limitations: string[];
  executable: false;
}

export class ForesightCampaignExperimentValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super('Invalid Foresight campaign experiment document.');
    this.name = 'ForesightCampaignExperimentValidationError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, path: string, issues: string[], maximum = 2_000): string {
  if (typeof value !== 'string' || !value.trim()) { issues.push(`${path} must be a non-empty string.`); return ''; }
  const result = value.trim();
  if (result.length > maximum) issues.push(`${path} must be ${maximum} characters or fewer.`);
  return result;
}

function positiveInteger(value: unknown, path: string, issues: string[], maximum = 1_000_000): number {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0 || result > maximum) issues.push(`${path} must be an integer from 1 to ${maximum}.`);
  return result;
}

function boundedNumber(value: unknown, path: string, issues: string[], minimum: number, maximum: number): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) issues.push(`${path} must be from ${minimum} to ${maximum}.`);
  return result;
}

function date(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) { issues.push(`${path} must be a YYYY-MM-DD date.`); return ''; }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) issues.push(`${path} must be a valid calendar date.`);
  return value;
}

function stringArray(value: unknown, path: string, issues: string[]): string[] {
  if (!Array.isArray(value)) { issues.push(`${path} must be an array.`); return []; }
  const result = value.map((item, index) => text(item, `${path}[${index}]`, issues));
  if (result.length === 0) issues.push(`${path} must contain at least one item.`);
  return result;
}

export function parseForesightCampaignExperimentDocument(value: unknown, expected: {
  lessonVersionId: number; lessonHash: string; lessonFactId: string;
}): ForesightCampaignExperimentDocument {
  const issues: string[] = [];
  const input = record(value);
  if (!input) throw new ForesightCampaignExperimentValidationError(['experiment must be an object.']);
  if (input.schemaVersion !== 1) issues.push('schemaVersion must be 1.');
  if (input.lessonVersionId !== expected.lessonVersionId) issues.push('lessonVersionId must match the accepted lesson.');
  if (input.lessonHash !== expected.lessonHash) issues.push('lessonHash must match the accepted lesson.');
  const hypothesisInput = record(input.hypothesis) ?? {};
  if (!record(input.hypothesis)) issues.push('hypothesis must be an object.');
  const citationFactIds = stringArray(hypothesisInput.citationFactIds, 'hypothesis.citationFactIds', issues);
  if (citationFactIds.some((id) => id !== expected.lessonFactId)) issues.push('hypothesis may cite only the exact accepted lesson fact.');
  const controlInput = record(input.control) ?? {};
  const treatmentInput = record(input.treatment) ?? {};
  const allocationInput = record(input.allocationPercent) ?? {};
  const analysisInput = record(input.analysis) ?? {};
  const startDate = date(input.startDate, 'startDate', issues);
  const endDate = date(input.endDate, 'endDate', issues);
  if (startDate && endDate) {
    const durationDays = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
    if (durationDays < 2 || durationDays > 90) issues.push('experiment duration must be from 2 to 90 days.');
  }
  const controlAllocation = boundedNumber(allocationInput.control, 'allocationPercent.control', issues, 1, 99);
  const treatmentAllocation = boundedNumber(allocationInput.treatment, 'allocationPercent.treatment', issues, 1, 99);
  if (controlAllocation + treatmentAllocation !== 100) issues.push('allocation percentages must total 100.');
  const channels = ['meta', 'google_ads', 'klaviyo'] as const;
  if (!channels.includes(input.channel as typeof channels[number])) issues.push('channel must be meta, google_ads, or klaviyo.');
  const metrics = ['conversion_rate', 'revenue_per_session', 'contribution_per_session'] as const;
  if (!metrics.includes(input.primaryMetric as CampaignExperimentMetric)) issues.push('primaryMetric is not supported.');
  if (analysisInput.method !== 'frequentist_two_sided' || analysisInput.confidenceLevel !== 0.95 || analysisInput.inconclusiveWhenUnderpowered !== true) {
    issues.push('analysis must use the governed two-sided 95% confidence method and mark underpowered results inconclusive.');
  }
  const guardrails = Array.isArray(input.guardrails) ? input.guardrails.map((value, index) => {
    const item = record(value) ?? {};
    if (!record(value)) issues.push(`guardrails[${index}] must be an object.`);
    return { metric: text(item.metric, `guardrails[${index}].metric`, issues, 100), maximumAdverseChangePercent: boundedNumber(item.maximumAdverseChangePercent, `guardrails[${index}].maximumAdverseChangePercent`, issues, 0, 100) };
  }) : (issues.push('guardrails must be an array.'), []);
  if (guardrails.length === 0) issues.push('guardrails must contain at least one item.');
  if (input.executable !== false) issues.push('executable must be false.');
  const document: ForesightCampaignExperimentDocument = {
    schemaVersion: 1,
    lessonVersionId: positiveInteger(input.lessonVersionId, 'lessonVersionId', issues),
    lessonHash: text(input.lessonHash, 'lessonHash', issues, 64),
    title: text(input.title, 'title', issues, 200),
    hypothesis: { text: text(hypothesisInput.text, 'hypothesis.text', issues), citationFactIds },
    channel: input.channel as ForesightCampaignExperimentDocument['channel'],
    audience: text(input.audience, 'audience', issues),
    control: { name: text(controlInput.name, 'control.name', issues, 100), description: text(controlInput.description, 'control.description', issues) },
    treatment: { name: text(treatmentInput.name, 'treatment.name', issues, 100), description: text(treatmentInput.description, 'treatment.description', issues) },
    allocationPercent: { control: controlAllocation, treatment: treatmentAllocation },
    startDate, endDate,
    minimumSamplePerVariant: positiveInteger(input.minimumSamplePerVariant, 'minimumSamplePerVariant', issues),
    primaryMetric: input.primaryMetric as CampaignExperimentMetric,
    minimumDetectableLiftPercent: boundedNumber(input.minimumDetectableLiftPercent, 'minimumDetectableLiftPercent', issues, 0.1, 100),
    guardrails,
    analysis: { method: 'frequentist_two_sided', confidenceLevel: 0.95, inconclusiveWhenUnderpowered: true },
    limitations: stringArray(input.limitations, 'limitations', issues),
    executable: false,
  };
  if (issues.length > 0) throw new ForesightCampaignExperimentValidationError(issues);
  return document;
}

export function hashForesightCampaignExperiment(document: ForesightCampaignExperimentDocument): string {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
}