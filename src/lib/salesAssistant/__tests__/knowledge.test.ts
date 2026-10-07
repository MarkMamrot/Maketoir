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
    expect(prospectIndex.sources.length).toBeGreaterThanOrEqual(60);
    for (const source of prospectIndex.sources) {
      expect(Object.keys(source).sort()).toEqual(['availability', 'capabilities', 'id', 'product', 'summary', 'title']);
    }

    const serialized = JSON.stringify(prospectIndex);
    expect(serialized).not.toMatch(/Main operations|Worked examples|businessId|getImsSession|\/api\/|docs\/help|topicId|sectionId|contexts|filename/i);
    expect(serialized).not.toMatch(/click the|navigate to|enter your|paste the|step 1/i);
    expect(prospectIndex.sources.some(source => source.id.startsWith('public-capability:ims-'))).toBe(true);
    expect(prospectIndex.sources.some(source => source.id.startsWith('public-capability:pos-'))).toBe(true);
    expect(prospectIndex.sources.some(source => source.id.startsWith('public-capability:wholesale-'))).toBe(true);
    expect(prospectIndex.sources.some(source => source.id.startsWith('public-capability:foresight-'))).toBe(true);
    expect(prospectIndex.sources.some(source => ['setup', 'shared'].includes(source.product))).toBe(false);
  });

  it('ranks relevant canonical sources and bounds result counts', () => {
    const pricing = retrieveProspectKnowledge({ query: 'pricing for 3 locations', limit: 99 });
    expect(pricing[0]?.id).toBe('prospect-pricing-offer');
    expect(pricing.length).toBeLessThanOrEqual(8);
    expect(retrieveProspectKnowledge({ query: '---' })).toEqual([]);
  });

  it('answers Shopify loyalty questions from the specific native capability source', () => {
    const results = retrieveProspectKnowledge({ query: 'does your system allow loyalty integrated with shopify?' });

    expect(results[0]).toMatchObject({
      id: 'prospect-shopify-loyalty', title: 'Shopify and Loyalty', availability: 'confirmed',
    });
    expect(results[0]?.summary).toMatch(/Yes.*one loyalty program.*POS.*Shopify/i);
    expect(results[0]?.capabilities).toContain('loyalty');
  });

  it.each([
    ['Can I connect two Shopify stores?', /multiple separately configured Shopify stores/i],
    ['What is Store Daybook?', /Daybook supports checklists/i],
    ['Can I use Amazon Australia?', /Amazon Australia seller-fulfilled/i],
    ['What does the $1 Starter offer include?', /3 months of Starter for a one-time \$1 payment/i],
    ['What does Growth cost?', /Growth:.*from \$159\/month.*\$199 without/i],
    ['How many integrations does Core include?', /Core:.*5 integrations/i],
  ])('keeps refreshed landing facts retrievable for %s', (query, expectedSummary) => {
    const results = retrieveProspectKnowledge({ query });
    expect(results.some(source => expectedSummary.test(source.summary))).toBe(true);
  });

  it.each([
    ['Can POS work offline?', 'public-capability:pos-settings-terminals-offline-recovery'],
    ['Can I partially receive purchase orders?', 'public-capability:ims-po-receiving-resolution'],
    ['Do you support gift cards and store credit?', 'public-capability:pos-gift-cards'],
    ['Can wholesale buyers save order lists?', 'public-capability:wholesale-ordering-saved-lists-stock-rules'],
    ['Can AI help plan marketing and review recommendations?', 'public-capability:foresight-recommendations-creative-review-audits'],
    ['Can I transfer stock between branches?', 'public-capability:ims-branch-transfers'],
    ['Can you manage customer returns and refunds?', 'public-capability:ims-customer-returns-refunds'],
    ['What sales and margin reports are available?', 'public-capability:ims-operational-reports'],
  ])('ranks the owning capability for %s', (query, expectedId) => {
    expect(retrieveProspectKnowledge({ query })[0]?.id).toBe(expectedId);
  });

  it('answers Growth feature questions with its complete commercial scope', () => {
    const result = retrieveProspectKnowledge({ query: 'Does Growth include wholesale and preferred AI credit rates?' })[0];
    expect(result.id).toBe('prospect-growth-plan');
    expect(result.summary).toMatch(/wholesale portal, preferred AI credit rates, self onboarding and a local helpdesk/);
    expect(result.summary).toMatch(/Custom shop domains are not included/);
    expect(result.summary).toMatch(/up to 10 users and 3 standard integrations/);
  });

  it('keeps every projected operational capability discoverable by its title', () => {
    const capabilitySources = prospectIndex.sources.filter(source => source.id.startsWith('public-capability:'));
    for (const source of capabilitySources) {
      expect(retrieveProspectKnowledge({ query: source.title })[0]?.id, source.title).toBe(source.id);
    }
  });

  it('accepts external public offerings without guaranteeing on-demand delivery', () => {
    const results = retrieveProspectKnowledge({
      query: 'Sample 3PL logistics fulfilment',
      externalIntegrationOfferings: [offering()],
    });

    expect(results[0]).toMatchObject({
      id: 'public-integration:sample-3pl', product: 'integration', availability: 'qualified',
    });
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