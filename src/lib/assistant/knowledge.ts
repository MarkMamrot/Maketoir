import assistantIndex from '@/generated/solvantis-assistant-index.json';

import type { AssistantAudience } from './policy';

export interface AssistantKnowledgeResult {
  id: string;
  title: string;
  heading: string;
  screen: string;
  topicId?: string;
  content: string;
  score: number;
}

interface IndexedChunk {
  id: string;
  title: string;
  heading: string;
  audiences: AssistantAudience[];
  capability: string;
  screen: string;
  contexts?: string[];
  content: string;
  sourcePriority?: number;
}

const TERM_ALIASES: Record<string, string[]> = {
  po: ['purchase', 'order'],
  pos: ['point', 'sale'],
  orders: ['order'],
  products: ['product'],
  variants: ['variant'],
  costs: ['cost'],
  locations: ['location'],
  receipts: ['receipt'],
  users: ['user'],
  wac: ['weighted', 'average', 'cost'],
  cogs: ['cost', 'goods', 'sold'],
  costing: ['cost'],
  valuation: ['value', 'cost'],
  inventory: ['stock'],
};

function terms(value: string): string[] {
  const raw = value.toLowerCase().match(/[a-z0-9]+/g)?.filter(term => term.length > 1) ?? [];
  return Array.from(new Set(raw.flatMap(term => [term, ...(TERM_ALIASES[term] ?? [])])));
}

export function retrieveAssistantKnowledge(input: {
  query: string;
  audience: AssistantAudience;
  currentView?: string | null;
  limit?: number;
}): AssistantKnowledgeResult[] {
  const queryTerms = new Set(terms(input.query));
  if (queryTerms.size === 0) return [];
  const currentView = input.currentView?.trim().toLowerCase() ?? '';

  const ranked = (assistantIndex.chunks as IndexedChunk[])
    .filter(chunk => chunk.audiences.includes(input.audience))
    .map(chunk => {
      const titleTerms = terms(`${chunk.title} ${chunk.heading}`);
      const bodyTerms = terms(chunk.content);
      const titleMatches = titleTerms.filter(term => queryTerms.has(term)).length;
      const bodyMatches = bodyTerms.filter(term => queryTerms.has(term)).length;
      const exactContextMatch = currentView && chunk.contexts?.some(context => context.toLowerCase() === currentView);
      const viewBoost = exactContextMatch ? 10 : currentView && (
        chunk.screen.toLowerCase().includes(currentView)
        || currentView.includes(chunk.screen.toLowerCase())
        || chunk.capability.toLowerCase() === currentView
      ) ? 4 : 0;
      return { ...chunk, score: titleMatches * 5 + bodyMatches + viewBoost + Number(chunk.sourcePriority ?? 0) };
    })
    .filter(chunk => chunk.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const limit = Math.min(Math.max(input.limit ?? 4, 1), 8);
  const topicCounts = new Map<string, number>();
  return ranked
    .filter(chunk => {
      const topic = chunk.topicId ?? chunk.title;
      const count = topicCounts.get(topic) ?? 0;
      if (count >= 2) return false;
      topicCounts.set(topic, count + 1);
      return true;
    })
    .slice(0, limit)
    .map(({ id, title, heading, screen, topicId, content, score }) => ({ id, title, heading, screen, topicId, content, score }));
}