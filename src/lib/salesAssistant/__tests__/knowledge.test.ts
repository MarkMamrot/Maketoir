import { describe, expect, it } from 'vitest';
import prospectIndex from '@/generated/solvantis-prospect-index.json';

import { retrieveProspectKnowledge } from '../knowledge';
import type { PublicIntegrationOffering } from '../types';

function offering(overrides: Partial<PublicIntegrationOffering> = {}): PublicIntegrationOffering {
  return {
    id: 1,
    slug: 'sample-3pl',
    name: 'Sample 3PL',
    category: 'logistics',
    deliveryMode: 'on_demand',
    publicSummary: 'A potential fulfilment connection for retailers with specialist logistics needs.',
    exampleProviders: ['Sample Provider'],
    supportedWorkflows: ['fulfilment updates'],
    qualificationQuestions: ['Which locations need fulfilment coverage?'],
    ...overrides,
  };
}

describe('prospect knowledge projection', () => {
  it('contains only whitelisted public summary fields', () => {
    expect(prospectIndex.sources.length).toBeGreaterThan(0);
    for (const source of prospectIndex.sources) {
      expect(Object.keys(source).sort()).toEqual(['capabilities', 'id', 'product', 'summary', 'title']);
    }

    const serialized = JSON.stringify(prospectIndex);
    expect(serialized).not.toMatch(/Main operations|Worked examples|businessId|getImsSession|\/api\/|docs\/help|topicId|sectionId|contexts|filename/i);
    expect(serialized).not.toMatch(/click the|navigate to|enter your|paste the|step 1/i);
  });

  it('ranks relevant canonical sources and bounds result counts', () => {
    const pricing = retrieveProspectKnowledge({ query: 'pricing for 3 locations', limit: 99 });
    expect(pricing[0]?.id).toBe('prospect-pricing-offer');
    expect(pricing.length).toBeLessThanOrEqual(8);
    expect(retrieveProspectKnowledge({ query: '---' })).toEqual([]);
  });

  it('accepts external public offerings without guaranteeing on-demand delivery', () => {
    const results = retrieveProspectKnowledge({
      query: 'Sample 3PL logistics fulfilment',
      externalIntegrationOfferings: [offering()],
    });

    expect(results[0]).toMatchObject({ id: 'public-integration:sample-3pl', product: 'integration' });
    expect(results[0]?.summary).toMatch(/on-demand.*discovery.*quote.*not guaranteed/i);
    expect(results[0]).not.toHaveProperty('topicId');
    expect(results[0]).not.toHaveProperty('anchor');
  });

  it('drops external offerings containing procedural or internal details', () => {
    const results = retrieveProspectKnowledge({
      query: 'unsafe provider setup',
      externalIntegrationOfferings: [
        offering({ slug: 'internal', name: 'Unsafe Provider', publicSummary: 'Use getImsSession and click the settings control.' }),
      ],
    });

    expect(results.some(result => result.id === 'public-integration:internal')).toBe(false);
    expect(JSON.stringify(results)).not.toMatch(/getImsSession|click the settings/i);
  });
});