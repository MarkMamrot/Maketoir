import type { ForesightPlanDocument } from './planDocument';
import type { PlanningFactSnapshot, PlanningLinkRow } from '../repositories/ForesightPlanningRepository';

export const FORESIGHT_PLAN_VALIDATOR_VERSION = 'foresight-plan-validator-v1';

export interface PlanDraftValidation {
  state: 'passed' | 'failed' | 'needs_human';
  findings: {
    blocking: string[];
    needsHuman: string[];
    warnings: string[];
  };
}

export function validatePlanDraft(
  plan: ForesightPlanDocument,
  facts: PlanningFactSnapshot[],
  links: PlanningLinkRow[],
): PlanDraftValidation {
  const blocking: string[] = [];
  const needsHuman: string[] = [];
  const warnings: string[] = [];
  const factsById = new Map(facts.map((fact) => [fact.factId, fact]));

  for (const citation of plan.citations) {
    const fact = factsById.get(citation.factId);
    if (!fact) {
      blocking.push(`Citation ${citation.factId} is not present in the thread's audited facts.`);
      continue;
    }
    if (citation.source !== fact.source || citation.authority !== fact.authority
      || citation.observedFrom !== fact.observedFrom || citation.observedThrough !== fact.observedThrough) {
      blocking.push(`Citation ${citation.factId} metadata does not match its audited fact.`);
    }
    const quality = fact.quality as { grade?: unknown; issues?: unknown };
    if (quality.grade === 'blocked') warnings.push(`Citation ${citation.factId} has blocked data quality.`);
    else if (quality.grade === 'partial') warnings.push(`Citation ${citation.factId} has partial data quality.`);
  }

  const linkedRecommendationIds = links
    .filter((link) => link.link_type === 'recommendation')
    .map((link) => Number(link.link_id))
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((left, right) => left - right);
  const planRecommendationIds = [...plan.recommendationIds].sort((left, right) => left - right);
  if (JSON.stringify(linkedRecommendationIds) !== JSON.stringify(planRecommendationIds)) {
    blocking.push('Plan recommendationIds must exactly match the recommendations linked to this thread.');
  }

  const strategyFacts = facts.filter((fact) => fact.factId.startsWith('foresight:strategy:'));
  const knownStrategyVersions = new Set(strategyFacts.map((fact) => Number(fact.value.version)).filter(Number.isInteger));
  if (plan.strategyVersion != null && !knownStrategyVersions.has(plan.strategyVersion)) {
    blocking.push(`Strategy version ${plan.strategyVersion} is not present in the thread's audited facts.`);
  }

  const unresolved = plan.questions.filter((question) => question.status === 'open' || question.status === 'unknown');
  if (unresolved.length > 0) needsHuman.push(`${unresolved.length} planning question${unresolved.length === 1 ? ' is' : 's are'} unresolved.`);
  if (plan.options.length > 0 && plan.selectedOptionId == null) needsHuman.push('No planning option has been selected.');
  if (plan.actions.length === 0) needsHuman.push('The plan has no reviewable actions.');
  if (plan.successMetrics.length === 0) needsHuman.push('The plan has no success metrics.');
  if (plan.guardrails.length === 0) needsHuman.push('The plan has no guardrails.');

  return {
    state: blocking.length > 0 ? 'failed' : needsHuman.length > 0 ? 'needs_human' : 'passed',
    findings: { blocking, needsHuman, warnings },
  };
}