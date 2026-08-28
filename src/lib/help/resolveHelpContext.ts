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

function topicRequiresXero(topic: HelpTopic): boolean {
  return /xero/i.test(topic.id) || /\bxero\b/i.test(`${topic.title} ${topic.screen}`);
}

const xeroTopicIds = new Set(topics.filter(topicRequiresXero).map(topic => topic.id));

function withoutXeroContent(topic: HelpTopic): HelpTopic | null {
  if (topicRequiresXero(topic)) return null;
  const contextSections = topic.contextSections
    ? Object.fromEntries(Object.entries(topic.contextSections).filter(([context, heading]) => !/\bxero\b/i.test(`${context} ${heading}`)))
    : undefined;
  return {
    ...topic,
    summary: /\bxero\b/i.test(topic.summary) ? topic.summary.replace(/\bXero\b/gi, 'accounting') : topic.summary,
    parentId: topic.parentId && (/xero/i.test(topic.parentId) || xeroTopicIds.has(topic.parentId)) ? null : topic.parentId,
    contexts: topic.contexts.filter(context => !/\bxero\b/i.test(context)),
    contextSections,
    relatedTopics: topic.relatedTopics?.filter(topicId => !xeroTopicIds.has(topicId)),
    sections: topic.sections
      .map(section => ({
        ...section,
        content: section.content.split('\n').filter(line => !/\bxero\b/i.test(line)).join('\n').trim(),
      }))
      .filter(section => section.content.length > 0 && !/\bxero\b/i.test(`${section.heading} ${section.content}`)),
  };
}

export function listHelpTopics(audience: AssistantAudience, product?: HelpProduct, xeroAccountingEnabled?: boolean): HelpTopic[] {
  return topics
    .filter(topic => topic.audiences.includes(audience)
      && (!product || topic.product === product || topic.product === 'shared'))
    .map(topic => xeroAccountingEnabled === false ? withoutXeroContent(topic) : topic)
    .filter((topic): topic is HelpTopic => topic !== null)
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0) || left.title.localeCompare(right.title));
}

export function resolveHelpContext(input: {
  audience: AssistantAudience;
  product: HelpProduct;
  context?: string | null;
  xeroAccountingEnabled?: boolean;
}): ResolvedHelpContext | null {
  const context = normalize(input.context);
  const available = listHelpTopics(input.audience, input.product, input.xeroAccountingEnabled).filter(topic => topic.product === input.product);
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

export function getHelpTopic(topicId: string, audience: AssistantAudience, xeroAccountingEnabled?: boolean): HelpTopic | null {
  const topic = topics.find(candidate => candidate.id === topicId && candidate.audiences.includes(audience));
  if (!topic) return null;
  return xeroAccountingEnabled === false ? withoutXeroContent(topic) : topic;
}