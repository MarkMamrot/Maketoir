import assistantIndex from '@/generated/solvantis-assistant-index.json';

import type { AssistantAudience } from './policy';

export interface AssistantKnowledgeResult {
  id: string;
  title: string;
  heading: string;
  screen: string;
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
  content: string;
}

function terms(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g)?.filter(term => term.length > 1) ?? [];
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

  return (assistantIndex.chunks as IndexedChunk[])
    .filter(chunk => chunk.audiences.includes(input.audience))
    .map(chunk => {
      const titleTerms = terms(`${chunk.title} ${chunk.heading}`);
      const bodyTerms = terms(chunk.content);
      const titleMatches = titleTerms.filter(term => queryTerms.has(term)).length;
      const bodyMatches = bodyTerms.filter(term => queryTerms.has(term)).length;
      const viewBoost = currentView && (
        chunk.screen.toLowerCase().includes(currentView)
        || currentView.includes(chunk.screen.toLowerCase())
        || chunk.capability.toLowerCase() === currentView
      ) ? 4 : 0;
      return { ...chunk, score: titleMatches * 5 + bodyMatches + viewBoost };
    })
    .filter(chunk => chunk.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, Math.min(Math.max(input.limit ?? 4, 1), 8))
    .map(({ id, title, heading, screen, content, score }) => ({ id, title, heading, screen, content, score }));
}