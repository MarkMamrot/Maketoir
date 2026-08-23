import helpIndex from '@/generated/solvantis-help-index.json';

import type { AssistantAudience } from '@/lib/assistant/policy';
import type { HelpProduct, HelpTopic, ResolvedHelpContext } from './types';

const topics = helpIndex.topics as HelpTopic[];

const productFallbacks: Partial<Record<HelpProduct, string>> = {
  ims: 'ims-workspaces',
  pos: 'pos-workspaces',
  wholesale: 'wholesale-portal',
  foresight: 'foresight-workspaces',
  dashboard: 'foresight-workspaces',
  setup: 'setup-connections',
};

function normalize(value?: string | null): string {
  return value?.trim().toLowerCase().replace(/^#/, '') ?? '';
}

export function listHelpTopics(audience: AssistantAudience, product?: HelpProduct): HelpTopic[] {
  return topics
    .filter(topic => topic.audiences.includes(audience) && (!product || topic.product === product || topic.product === 'shared'))
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0) || left.title.localeCompare(right.title));
}

export function resolveHelpContext(input: {
  audience: AssistantAudience;
  product: HelpProduct;
  context?: string | null;
}): ResolvedHelpContext | null {
  const context = normalize(input.context);
  const available = listHelpTopics(input.audience, input.product).filter(topic => topic.product === input.product);
  const exactTopic = context
    ? available
      .filter(topic => topic.contexts.some(alias => normalize(alias) === context))
      .sort((left, right) => left.contexts.length - right.contexts.length)[0]
    : undefined;
  const topic = exactTopic
    ?? available.find(candidate => candidate.id === productFallbacks[input.product])
    ?? available[0];
  if (!topic) return null;
  const sectionHeading = exactTopic?.contextSections?.[context];
  const section = sectionHeading
    ? topic.sections.find(candidate => normalize(candidate.heading) === normalize(sectionHeading))
    : undefined;
  return { topic, sectionId: section?.id ?? null, exact: !!exactTopic };
}

export function getHelpTopic(topicId: string, audience: AssistantAudience): HelpTopic | null {
  return topics.find(topic => topic.id === topicId && topic.audiences.includes(audience)) ?? null;
}