import { describe, expect, it } from 'vitest';

import { retrieveAssistantKnowledge } from '../knowledge';

describe('assistant knowledge retrieval', () => {
  it('filters by verified audience before ranking', () => {
    const results = retrieveAssistantKnowledge({
      query: 'partial customer fulfilment outstanding balance',
      audience: 'wholesale',
    });
    expect(results.every(result => result.title !== 'Purchase and sales order workflows')).toBe(true);
  });

  it('returns the IMS order workflow for partial fulfilment questions', () => {
    const [result] = retrieveAssistantKnowledge({
      query: 'How do I partially fulfil a customer sales order?',
      audience: 'ims',
      currentView: 'orders',
    });
    expect(result).toEqual(expect.objectContaining({
      title: 'Purchase and sales order workflows',
      screen: 'Orders',
    }));
  });

  it('keeps wholesale account ownership guidance within wholesale results', () => {
    const results = retrieveAssistantKnowledge({
      query: 'Can I see another company location order?',
      audience: 'wholesale',
    });
    expect(results.some(result => result.heading === 'Account and location boundaries')).toBe(true);
  });

  it('returns no results for an empty query', () => {
    expect(retrieveAssistantKnowledge({ query: ' ', audience: 'ims' })).toEqual([]);
  });
});