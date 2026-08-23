import type { HelpSection, HelpTopic } from './types';

export interface HelpSearchResult {
  topic: HelpTopic;
  section: HelpSection;
  snippet: string;
}

function plainText(value: string): string {
  return value
    .replace(/\[([^\]]+)]\([^\)]+\)/g, '$1')
    .replace(/[*_`>#|\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchingSnippet(content: string, query: string): string {
  const text = plainText(content);
  const matchAt = text.toLowerCase().indexOf(query);
  const start = Math.max(0, matchAt < 0 ? 0 : matchAt - 48);
  const end = Math.min(text.length, start + 140);
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
}

export function searchHelpTopics(topics: HelpTopic[], value: string): HelpSearchResult[] {
  const query = value.trim().toLowerCase();
  if (!query) return [];
  return topics.flatMap(topic => topic.sections
    .filter(section => `${topic.title} ${topic.summary} ${section.heading} ${section.content}`.toLowerCase().includes(query))
    .map(section => ({ topic, section, snippet: matchingSnippet(section.content, query) })));
}