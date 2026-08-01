import { createHash } from 'node:crypto';

export const FORESIGHT_CAMPAIGN_LESSON_SCHEMA_VERSION = 1;

export interface ForesightCampaignLessonDocument {
  schemaVersion: 1;
  outcomeId: number;
  activationId: number;
  title: string;
  observations: Array<{ text: string; citationFactIds: string[] }>;
  limitations: string[];
  hypotheses: Array<{ text: string; status: 'requires_human_validation'; validationApproach: string }>;
  suggestedApplications: Array<{ text: string; executable: false }>;
}

export class ForesightCampaignLessonValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super('Invalid Foresight campaign lesson document.');
    this.name = 'ForesightCampaignLessonValidationError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown, path: string, issues: string[], maximum = 2_000): string {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push(`${path} must be a non-empty string.`);
    return '';
  }
  const result = value.trim();
  if (result.length > maximum) issues.push(`${path} must be ${maximum} characters or fewer.`);
  return result;
}

function positiveInteger(value: unknown, path: string, issues: string[]): number {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) issues.push(`${path} must be a positive integer.`);
  return result;
}

function stringArray(value: unknown, path: string, issues: string[], minimum = 1): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array.`);
    return [];
  }
  const result = value.map((item, index) => text(item, `${path}[${index}]`, issues));
  if (result.length < minimum) issues.push(`${path} must contain at least ${minimum} item(s).`);
  return result;
}

export function parseForesightCampaignLessonDocument(value: unknown, expected: {
  outcomeId: number;
  activationId: number;
  outcomeFactId: string;
}): ForesightCampaignLessonDocument {
  const issues: string[] = [];
  const input = record(value);
  if (!input) throw new ForesightCampaignLessonValidationError(['lesson must be an object.']);
  if (input.schemaVersion !== FORESIGHT_CAMPAIGN_LESSON_SCHEMA_VERSION) issues.push('schemaVersion must be 1.');
  if (input.outcomeId !== expected.outcomeId) issues.push('outcomeId must match the source outcome.');
  if (input.activationId !== expected.activationId) issues.push('activationId must match the source activation.');
  const observations = Array.isArray(input.observations) ? input.observations.map((value, index) => {
    const item = record(value) ?? {};
    if (!record(value)) issues.push(`observations[${index}] must be an object.`);
    const citationFactIds = stringArray(item.citationFactIds, `observations[${index}].citationFactIds`, issues);
    if (citationFactIds.some((id) => id !== expected.outcomeFactId)) {
      issues.push(`observations[${index}] may cite only the exact source campaign outcome fact.`);
    }
    return { text: text(item.text, `observations[${index}].text`, issues), citationFactIds };
  }) : (issues.push('observations must be an array.'), []);
  if (observations.length === 0) issues.push('observations must contain at least one cited observation.');
  const hypotheses = Array.isArray(input.hypotheses) ? input.hypotheses.map((value, index) => {
    const item = record(value) ?? {};
    if (!record(value)) issues.push(`hypotheses[${index}] must be an object.`);
    if (item.status !== 'requires_human_validation') issues.push(`hypotheses[${index}].status must require human validation.`);
    return {
      text: text(item.text, `hypotheses[${index}].text`, issues),
      status: 'requires_human_validation' as const,
      validationApproach: text(item.validationApproach, `hypotheses[${index}].validationApproach`, issues),
    };
  }) : (issues.push('hypotheses must be an array.'), []);
  const suggestedApplications = Array.isArray(input.suggestedApplications) ? input.suggestedApplications.map((value, index) => {
    const item = record(value) ?? {};
    if (!record(value)) issues.push(`suggestedApplications[${index}] must be an object.`);
    if (item.executable !== false) issues.push(`suggestedApplications[${index}].executable must be false.`);
    return { text: text(item.text, `suggestedApplications[${index}].text`, issues), executable: false as const };
  }) : (issues.push('suggestedApplications must be an array.'), []);
  const document: ForesightCampaignLessonDocument = {
    schemaVersion: 1,
    outcomeId: positiveInteger(input.outcomeId, 'outcomeId', issues),
    activationId: positiveInteger(input.activationId, 'activationId', issues),
    title: text(input.title, 'title', issues, 200),
    observations,
    limitations: stringArray(input.limitations, 'limitations', issues),
    hypotheses,
    suggestedApplications,
  };
  if (issues.length > 0) throw new ForesightCampaignLessonValidationError(issues);
  return document;
}

export function hashForesightCampaignLesson(document: ForesightCampaignLessonDocument): string {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
}