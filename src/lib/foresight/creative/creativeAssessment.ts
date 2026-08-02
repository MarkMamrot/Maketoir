export const CREATIVE_ASSESSMENT_SCHEMA_VERSION = 1 as const;

export interface CreativeAssessmentDocument {
  schemaVersion: 1;
  factualDescription: string;
  structuredTags: string[];
  brandFitObservations: string[];
  accessibilityIssues: string[];
  compositionTraits: string[];
  formatTraits: string[];
  uncertainties: string[];
  confidence: number;
}

export class CreativeAssessmentValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join(' '));
    this.name = 'CreativeAssessmentValidationError';
  }
}

function object(value: unknown, path: string, issues: string[]): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(`${path} must be an object.`);
    return {};
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, path: string, issues: string[], maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push(`${path} must be a non-empty string.`);
    return '';
  }
  const result = value.trim();
  if (result.length > maximum) issues.push(`${path} must be at most ${maximum} characters.`);
  return result;
}

function textList(value: unknown, path: string, issues: string[]): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array.`);
    return [];
  }
  if (value.length > 20) issues.push(`${path} must contain at most 20 items.`);
  const result = value.slice(0, 20).map((item, index) => boundedText(item, `${path}[${index}]`, issues, 500));
  if (new Set(result.map((item) => item.toLowerCase())).size !== result.length) issues.push(`${path} must not contain duplicates.`);
  return result;
}

const PROTECTED_TRAIT_PATTERN = /\b(race|racial|ethnicity|ethnic|religion|religious|sexual orientation|gay|lesbian|transgender|disability|disabled|pregnan\w*|health condition|political affiliation)\b/i;

export function parseCreativeAssessment(value: unknown): CreativeAssessmentDocument {
  const issues: string[] = [];
  const input = object(value, 'assessment', issues);
  const allowed = new Set([
    'schemaVersion', 'factualDescription', 'structuredTags', 'brandFitObservations',
    'accessibilityIssues', 'compositionTraits', 'formatTraits', 'uncertainties', 'confidence',
  ]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) issues.push(`assessment.${key} is not allowed.`);
  if (input.schemaVersion !== CREATIVE_ASSESSMENT_SCHEMA_VERSION) issues.push('assessment.schemaVersion must be 1.');
  const document: CreativeAssessmentDocument = {
    schemaVersion: CREATIVE_ASSESSMENT_SCHEMA_VERSION,
    factualDescription: boundedText(input.factualDescription, 'assessment.factualDescription', issues, 2_000),
    structuredTags: textList(input.structuredTags, 'assessment.structuredTags', issues),
    brandFitObservations: textList(input.brandFitObservations, 'assessment.brandFitObservations', issues),
    accessibilityIssues: textList(input.accessibilityIssues, 'assessment.accessibilityIssues', issues),
    compositionTraits: textList(input.compositionTraits, 'assessment.compositionTraits', issues),
    formatTraits: textList(input.formatTraits, 'assessment.formatTraits', issues),
    uncertainties: textList(input.uncertainties, 'assessment.uncertainties', issues),
    confidence: typeof input.confidence === 'number' && Number.isFinite(input.confidence) ? input.confidence : -1,
  };
  if (document.confidence < 0 || document.confidence > 1) issues.push('assessment.confidence must be between 0 and 1.');
  const claims = [document.factualDescription, ...document.structuredTags, ...document.brandFitObservations,
    ...document.accessibilityIssues, ...document.compositionTraits, ...document.formatTraits];
  if (claims.some((claim) => PROTECTED_TRAIT_PATTERN.test(claim))) {
    issues.push('assessment must not infer or classify protected traits.');
  }
  if (issues.length) throw new CreativeAssessmentValidationError(issues);
  return document;
}
