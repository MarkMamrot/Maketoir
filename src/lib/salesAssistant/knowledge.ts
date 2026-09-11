import prospectIndex from '@/generated/solvantis-prospect-index.json';

import type { ProspectKnowledgeSource, PublicIntegrationOffering } from './types';

export interface RankedProspectKnowledgeSource extends ProspectKnowledgeSource {
  score: number;
}

interface ProspectIndex {
  version: number;
  sources: ProspectKnowledgeSource[];
}

const MAX_RESULTS = 8;
const MAX_EXTERNAL_OFFERINGS = 50;
const stopWords = new Set([
  'about', 'allow', 'and', 'are', 'can', 'could', 'does', 'for', 'from', 'have',
  'how', 'into', 'our', 'system', 'that', 'the', 'this', 'what', 'with', 'work',
  'would', 'you', 'your',
]);
const unsafePublicDataPatterns = [
  /\b(?:businessId|getImsSession|runImsForBusiness|imsQuery|imsExecute|AsyncLocalStorage)\b/i,
  /\b(?:tenant|schema|database|table|cookie|session token)\b/i,
  /\b(?:password|credential|secret|access token|api key|authorization header)\b/i,
  /(?:^|[\s(])(?:src|scripts|e2e)\/[A-Za-z0-9_./[\]-]+/i,
  /\/api\/[A-Za-z0-9_./[\]-]+/i,
  /\b(?:CREATE|ALTER|DROP)\s+TABLE\b|\bSELECT\s+.+\s+FROM\b|\bINSERT\s+INTO\b|\bDELETE\s+FROM\b/i,
];
const unsafePublicKnowledgePatterns = [
  ...unsafePublicDataPatterns,
  /\b(?:click|navigate|open)\s+(?:the|to|in)\b/i,
  /\b(?:enter|paste|copy)\s+(?:your|the)\b/i,
  /\bstep\s+\d+\b/i,
];
const aliases: Record<string, string[]> = {
  '3pl': ['logistics', 'integration'],
  branches: ['branch'],
  cards: ['card'],
  ecommerce: ['commerce', 'shopify', 'online'],
  fulfil: ['fulfilment'],
  fulfilled: ['fulfilment'],
  integrations: ['integration'],
  locations: ['location'],
  partially: ['partial'],
  pos: ['point', 'sale'],
  prices: ['pricing'],
  pricing: ['price', 'prices'],
  receiving: ['receive'],
  refunds: ['refund', 'returns', 'return'],
  reports: ['report', 'analytics'],
  returns: ['return', 'refund'],
  shop: ['commerce', 'online'],
  transfers: ['transfer'],
};

function terms(value: string): string[] {
  const raw = value.toLowerCase().match(/[a-z0-9]+/g)
    ?.filter(term => term.length > 1 && !stopWords.has(term)) ?? [];
  return Array.from(new Set(raw.flatMap(term => [term, ...(aliases[term] ?? [])])));
}

function cleanPublicText(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizedPhrase(value: string): string {
  return value.toLocaleLowerCase('en-AU').replace(/[^a-z0-9]+/g, ' ').trim();
}

function isPublicSafe(source: ProspectKnowledgeSource): boolean {
  const value = `${source.id} ${source.title} ${source.summary} ${source.capabilities.join(' ')} ${source.product}`;
  const patterns = source.id.startsWith('public-capability:')
    ? unsafePublicDataPatterns
    : unsafePublicKnowledgePatterns;
  return !patterns.some(pattern => pattern.test(value));
}

function externalOfferingSource(offering: PublicIntegrationOffering): ProspectKnowledgeSource | null {
  const name = cleanPublicText(offering.name, 120);
  const publicSummary = cleanPublicText(offering.publicSummary, 500);
  if (!name || !publicSummary) return null;

  const deliveryStatement = offering.deliveryMode === 'native'
    ? 'This is a native Solvantis integration offering.'
    : offering.deliveryMode === 'beta'
      ? 'This is a beta offering, so availability and scope must be confirmed.'
      : 'This is an on-demand offering assessed during discovery; scope and pricing require a quote, and availability is not guaranteed.';
  const source: ProspectKnowledgeSource = {
    id: `public-integration:${cleanPublicText(offering.slug, 100)}`,
    title: `${name} integration`,
    summary: `${publicSummary} ${deliveryStatement}`,
    capabilities: Array.from(new Set([
      'integrations',
      cleanPublicText(offering.category, 80),
      ...offering.supportedWorkflows.slice(0, 12).map(value => cleanPublicText(value, 100)),
    ].filter(Boolean))),
    product: 'integration',
    availability: offering.deliveryMode === 'native' ? 'confirmed' : 'qualified',
  };
  return isPublicSafe(source) ? source : null;
}

export function retrieveProspectKnowledge(input: {
  query: string;
  externalIntegrationOfferings?: PublicIntegrationOffering[];
  limit?: number;
}): RankedProspectKnowledgeSource[] {
  const queryTerms = new Set(terms(input.query));
  if (queryTerms.size === 0) return [];

  const externalSources = (input.externalIntegrationOfferings ?? [])
    .slice(0, MAX_EXTERNAL_OFFERINGS)
    .map(externalOfferingSource)
    .filter((source): source is ProspectKnowledgeSource => source !== null);
  const candidates = [...(prospectIndex as ProspectIndex).sources, ...externalSources].filter(isPublicSafe);
  const limit = Math.min(Math.max(input.limit ?? 4, 1), MAX_RESULTS);
  const indexedTerms = candidates.map(source => ({
    source,
    title: new Set(terms(source.title)),
    capabilities: new Set(terms(source.capabilities.join(' '))),
    summary: new Set(terms(source.summary)),
  }));
  const documentFrequency = new Map<string, number>();
  for (const candidate of indexedTerms) {
    const searchable = new Set([...candidate.title, ...candidate.capabilities, ...candidate.summary]);
    for (const term of searchable) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }

  return indexedTerms
    .map(({ source, title, capabilities, summary }) => {
      let score = source.product === 'prospect' ? 2 : 0;
      if (normalizedPhrase(input.query) === normalizedPhrase(source.title)) score += 100;
      for (const term of queryTerms) {
        const fieldWeight = title.has(term) ? 6 : capabilities.has(term) ? 4 : summary.has(term) ? 2 : 0;
        if (!fieldWeight) continue;
        const rarity = 1 + Math.log((candidates.length + 1) / ((documentFrequency.get(term) ?? 0) + 1));
        score += fieldWeight * rarity;
      }
      return { ...source, score };
    })
    .filter(source => source.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);
}
