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

  it('returns the exact purchase-order navigation section', () => {
    const [result] = retrieveAssistantKnowledge({
      query: 'Where is the purchase order screen?',
      audience: 'ims',
    });
    expect(result).toEqual(expect.objectContaining({
      heading: 'Purchase Orders',
      screen: 'Purchasing > Purchase Orders',
    }));
    expect(result.content).toContain('Purchasing > Purchase Orders');
    expect(result.title).toBe('Purchase Orders');
  });

  it('returns actionable purchase-order creation guidance for PO synonyms', () => {
    const results = retrieveAssistantKnowledge({
      query: 'Can I make a PO in Solvantis?',
      audience: 'ims',
    });
    const creation = results.find(result => result.content.includes('New Purchase Order'));
    expect(creation?.content).toContain('New Purchase Order');
    expect(results.some(result => result.content.includes('Advisor'))).toBe(true);
  });

  it('explains that counted POS EOD closure triggers Xero sync', () => {
    const results = retrieveAssistantKnowledge({
      query: 'At what point does Solvantis send Xero syncs for POS sales?',
      audience: 'ims',
      currentView: 'eod',
    });
    const timing = results.find(result => result.title === 'End of Day and Xero');
    expect(timing?.content).toContain('not sent to Xero individually at checkout');
    expect(timing?.content).toContain('automatically starts');
  });

  it('returns the organisation-wide weighted-average inventory cost method', () => {
    const [result] = retrieveAssistantKnowledge({
      query: 'What kind of inventory cost system does Solvantis use?',
      audience: 'ims',
    });
    expect(result).toEqual(expect.objectContaining({
      title: 'Solvantis product reference',
      heading: 'IMS inventory costing and stock value',
      screen: 'Products',
    }));
    expect(result.content).toContain('organisation-wide weighted-average cost');
    expect(result.content).toContain('not FIFO or LIFO');
  });

  it('recognizes WAC and COGS inventory terminology', () => {
    const results = retrieveAssistantKnowledge({
      query: 'Does WAC feed COGS and stock valuation?',
      audience: 'ims',
    });
    const costing = results.find(result => result.heading === 'IMS inventory costing and stock value');
    expect(costing?.content).toContain('fallback cost of goods sold');
    expect(costing?.content).toContain('inventory valuation');
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