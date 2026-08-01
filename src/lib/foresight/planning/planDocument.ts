import { createHash } from 'node:crypto';

export const FORESIGHT_PLAN_SCHEMA_VERSION = 1;

export type PlanningThreadType = 'strategy' | 'recommendation' | 'initiative';
export type PlanningThreadState =
  | 'discovering'
  | 'awaiting_human'
  | 'drafting'
  | 'ready_for_validation'
  | 'validated'
  | 'locked_for_approval'
  | 'approved'
  | 'rejected'
  | 'active'
  | 'measuring'
  | 'completed'
  | 'superseded';

export type PlanningStatementKind = 'fact' | 'human_context' | 'assumption' | 'inference' | 'proposal';
export type PlanningFactAuthority = 'authoritative' | 'diagnostic' | 'human';

export interface PlanningCitation {
  factId: string;
  source: string;
  authority: PlanningFactAuthority;
  observedFrom: string | null;
  observedThrough: string | null;
}

export interface PlanningStatement {
  kind: PlanningStatementKind;
  text: string;
  citationFactIds: string[];
}

export interface PlanningQuestion {
  id: string;
  question: string;
  rationale: string;
  requiredFor: string[];
  status: 'open' | 'answered' | 'skipped' | 'unknown';
  answer: string | null;
}

export interface PlanningOption {
  id: string;
  title: string;
  summary: string;
  benefits: string[];
  risks: string[];
  evidenceRequired: string[];
}

export interface PlanningAction {
  id: string;
  title: string;
  actionType: string;
  owner: 'human' | 'ai_draft' | 'algorithm';
  executable: false;
  rationale: string;
  dependencies: string[];
}

export interface ForesightPlanDocument {
  schemaVersion: 1;
  title: string;
  objective: string;
  planningHorizon: string;
  strategyVersion: number | null;
  recommendationIds: number[];
  humanGoals: string[];
  targetAudiences: string[];
  constraints: string[];
  citations: PlanningCitation[];
  statements: PlanningStatement[];
  questions: PlanningQuestion[];
  options: PlanningOption[];
  selectedOptionId: string | null;
  actions: PlanningAction[];
  successMetrics: string[];
  guardrails: string[];
  monitoringPlan: {
    reviewDate: string | null;
    stopConditions: string[];
  };
  confidence: number;
}

export class ForesightPlanValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super('Invalid Foresight plan document.');
    this.name = 'ForesightPlanValidationError';
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

function nullableText(value: unknown, path: string, issues: string[]): string | null {
  if (value == null) return null;
  return text(value, path, issues);
}

function stringArray(value: unknown, path: string, issues: string[]): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array.`);
    return [];
  }
  return value.map((item, index) => text(item, `${path}[${index}]`, issues));
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  issues: string[],
): T {
  if (!allowed.includes(value as T)) {
    issues.push(`${path} must be one of ${allowed.join(', ')}.`);
    return allowed[0];
  }
  return value as T;
}

function parseCitations(value: unknown, issues: string[]): PlanningCitation[] {
  if (!Array.isArray(value)) {
    issues.push('citations must be an array.');
    return [];
  }
  return value.map((item, index) => {
    const input = record(item) ?? {};
    if (!record(item)) issues.push(`citations[${index}] must be an object.`);
    return {
      factId: text(input.factId, `citations[${index}].factId`, issues),
      source: text(input.source, `citations[${index}].source`, issues),
      authority: enumValue(input.authority, ['authoritative', 'diagnostic', 'human'] as const, `citations[${index}].authority`, issues),
      observedFrom: nullableText(input.observedFrom, `citations[${index}].observedFrom`, issues),
      observedThrough: nullableText(input.observedThrough, `citations[${index}].observedThrough`, issues),
    };
  });
}

export function parseForesightPlanDocument(value: unknown): ForesightPlanDocument {
  const issues: string[] = [];
  const input = record(value);
  if (!input) throw new ForesightPlanValidationError(['plan must be an object.']);
  if (input.schemaVersion !== FORESIGHT_PLAN_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${FORESIGHT_PLAN_SCHEMA_VERSION}.`);
  }
  const citations = parseCitations(input.citations, issues);
  const citationIds = new Set(citations.map((citation) => citation.factId));
  const statements = Array.isArray(input.statements) ? input.statements.map((item, index) => {
    const statement = record(item) ?? {};
    if (!record(item)) issues.push(`statements[${index}] must be an object.`);
    const kind = enumValue(statement.kind, ['fact', 'human_context', 'assumption', 'inference', 'proposal'] as const, `statements[${index}].kind`, issues);
    const citationFactIds = stringArray(statement.citationFactIds, `statements[${index}].citationFactIds`, issues);
    if (kind === 'fact' && citationFactIds.length === 0) {
      issues.push(`statements[${index}] facts require at least one citation.`);
    }
    for (const factId of citationFactIds) {
      if (!citationIds.has(factId)) issues.push(`statements[${index}] references unknown fact ${factId}.`);
    }
    return { kind, text: text(statement.text, `statements[${index}].text`, issues), citationFactIds };
  }) : (issues.push('statements must be an array.'), []);
  const questions = Array.isArray(input.questions) ? input.questions.map((item, index) => {
    const question = record(item) ?? {};
    if (!record(item)) issues.push(`questions[${index}] must be an object.`);
    return {
      id: text(question.id, `questions[${index}].id`, issues),
      question: text(question.question, `questions[${index}].question`, issues),
      rationale: text(question.rationale, `questions[${index}].rationale`, issues),
      requiredFor: stringArray(question.requiredFor, `questions[${index}].requiredFor`, issues),
      status: enumValue(question.status, ['open', 'answered', 'skipped', 'unknown'] as const, `questions[${index}].status`, issues),
      answer: nullableText(question.answer, `questions[${index}].answer`, issues),
    };
  }) : (issues.push('questions must be an array.'), []);
  const options = Array.isArray(input.options) ? input.options.map((item, index) => {
    const option = record(item) ?? {};
    if (!record(item)) issues.push(`options[${index}] must be an object.`);
    return {
      id: text(option.id, `options[${index}].id`, issues),
      title: text(option.title, `options[${index}].title`, issues),
      summary: text(option.summary, `options[${index}].summary`, issues),
      benefits: stringArray(option.benefits, `options[${index}].benefits`, issues),
      risks: stringArray(option.risks, `options[${index}].risks`, issues),
      evidenceRequired: stringArray(option.evidenceRequired, `options[${index}].evidenceRequired`, issues),
    };
  }) : (issues.push('options must be an array.'), []);
  const optionIds = new Set(options.map((option) => option.id));
  const selectedOptionId = nullableText(input.selectedOptionId, 'selectedOptionId', issues);
  if (selectedOptionId && !optionIds.has(selectedOptionId)) issues.push('selectedOptionId must reference an existing option.');
  const actions = Array.isArray(input.actions) ? input.actions.map((item, index) => {
    const action = record(item) ?? {};
    if (!record(item)) issues.push(`actions[${index}] must be an object.`);
    if (action.executable !== false) issues.push(`actions[${index}].executable must be false.`);
    return {
      id: text(action.id, `actions[${index}].id`, issues),
      title: text(action.title, `actions[${index}].title`, issues),
      actionType: text(action.actionType, `actions[${index}].actionType`, issues),
      owner: enumValue(action.owner, ['human', 'ai_draft', 'algorithm'] as const, `actions[${index}].owner`, issues),
      executable: false as const,
      rationale: text(action.rationale, `actions[${index}].rationale`, issues),
      dependencies: stringArray(action.dependencies, `actions[${index}].dependencies`, issues),
    };
  }) : (issues.push('actions must be an array.'), []);
  const monitoring = record(input.monitoringPlan) ?? {};
  if (!record(input.monitoringPlan)) issues.push('monitoringPlan must be an object.');
  const confidence = typeof input.confidence === 'number' && Number.isFinite(input.confidence)
    ? input.confidence
    : (issues.push('confidence must be a number.'), 0);
  if (confidence < 0 || confidence > 1) issues.push('confidence must be from 0 to 1.');
  const recommendationIds = Array.isArray(input.recommendationIds)
    ? input.recommendationIds.map((id, index) => {
        if (!Number.isInteger(id) || Number(id) <= 0) issues.push(`recommendationIds[${index}] must be a positive integer.`);
        return Number(id);
      })
    : (issues.push('recommendationIds must be an array.'), []);
  const strategyVersion = input.strategyVersion == null ? null : Number(input.strategyVersion);
  if (strategyVersion != null && (!Number.isInteger(strategyVersion) || strategyVersion < 0)) {
    issues.push('strategyVersion must be null or a non-negative integer.');
  }
  const plan: ForesightPlanDocument = {
    schemaVersion: 1,
    title: text(input.title, 'title', issues),
    objective: text(input.objective, 'objective', issues),
    planningHorizon: text(input.planningHorizon, 'planningHorizon', issues),
    strategyVersion,
    recommendationIds,
    humanGoals: stringArray(input.humanGoals, 'humanGoals', issues),
    targetAudiences: stringArray(input.targetAudiences, 'targetAudiences', issues),
    constraints: stringArray(input.constraints, 'constraints', issues),
    citations,
    statements,
    questions,
    options,
    selectedOptionId,
    actions,
    successMetrics: stringArray(input.successMetrics, 'successMetrics', issues),
    guardrails: stringArray(input.guardrails, 'guardrails', issues),
    monitoringPlan: {
      reviewDate: nullableText(monitoring.reviewDate, 'monitoringPlan.reviewDate', issues),
      stopConditions: stringArray(monitoring.stopConditions, 'monitoringPlan.stopConditions', issues),
    },
    confidence,
  };
  if (issues.length > 0) throw new ForesightPlanValidationError(issues);
  return plan;
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

export function hashForesightPlan(plan: ForesightPlanDocument): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(plan))).digest('hex');
}

function bullets(values: string[], empty = 'None recorded.'): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : [`- ${empty}`];
}

export function renderForesightPlanMarkdown(plan: ForesightPlanDocument): string {
  const selected = plan.options.find((option) => option.id === plan.selectedOptionId);
  return [
    `# ${plan.title}`,
    '',
    `**Objective:** ${plan.objective}`,
    `**Planning horizon:** ${plan.planningHorizon}`,
    `**Confidence:** ${(plan.confidence * 100).toFixed(0)}%`,
    '',
    '## Human Goals',
    ...bullets(plan.humanGoals),
    '',
    '## Target Audiences',
    ...bullets(plan.targetAudiences),
    '',
    '## Constraints',
    ...bullets(plan.constraints),
    '',
    '## Evidence And Reasoning',
    ...plan.statements.map((statement) => `- **${statement.kind.replace('_', ' ')}:** ${statement.text}${statement.citationFactIds.length ? ` [${statement.citationFactIds.join(', ')}]` : ''}`),
    ...(plan.statements.length ? [] : ['- None recorded.']),
    '',
    '## Open Questions',
    ...plan.questions.filter((question) => question.status === 'open').map((question) => `- ${question.question} (${question.rationale})`),
    ...(plan.questions.some((question) => question.status === 'open') ? [] : ['- None.']),
    '',
    '## Options Considered',
    ...plan.options.flatMap((option) => [
      `### ${option.title}${option.id === plan.selectedOptionId ? ' (Selected)' : ''}`,
      option.summary,
      '',
      '**Benefits**',
      ...bullets(option.benefits),
      '',
      '**Risks**',
      ...bullets(option.risks),
      '',
    ]),
    '## Selected Plan',
    selected ? selected.summary : 'No option selected.',
    '',
    '## Actions',
    ...plan.actions.map((action) => `- **${action.title}** (${action.owner}): ${action.rationale}`),
    ...(plan.actions.length ? [] : ['- None recorded.']),
    '',
    '## Success Metrics',
    ...bullets(plan.successMetrics),
    '',
    '## Guardrails',
    ...bullets(plan.guardrails),
    '',
    '## Monitoring',
    `- Review date: ${plan.monitoringPlan.reviewDate ?? 'Not set'}`,
    ...plan.monitoringPlan.stopConditions.map((condition) => `- Stop condition: ${condition}`),
    '',
    '## Evidence Sources',
    ...plan.citations.map((citation) => `- ${citation.factId}: ${citation.source} (${citation.authority}, ${citation.observedFrom ?? 'unknown'} to ${citation.observedThrough ?? 'unknown'})`),
    ...(plan.citations.length ? [] : ['- None recorded.']),
  ].join('\n');
}