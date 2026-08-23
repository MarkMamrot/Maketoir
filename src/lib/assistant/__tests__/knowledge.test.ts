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
      title: 'Customer Orders, Allocation, and Credits',
      heading: 'Sales orders',
      screen: 'Sales',
      topicId: 'ims-customer-orders',
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
    const creation = results.find(result => result.title === 'Purchase Orders' && result.content.includes('New Purchase Order'));
    expect(creation?.content).toContain('New Purchase Order');
    expect(creation?.content).toContain('Advisor');
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

  it('explains Shopify Misc Charge as an unmatched variant fallback', () => {
    const results = retrieveAssistantKnowledge({
      query: 'Why does my online order have Shopify Misc Charge in IMS?',
      audience: 'ims',
      currentView: 'online-sales',
    });
    const explanation = results.find(result => result.heading === 'POS and online sales');
    expect(explanation?.content).toContain('not an extra fee');
    expect(explanation?.content).toContain('no variant ID or its Shopify variant is not linked');
    expect(results.some(result => result.content.includes('product-mapping fallback, not a Xero policy charge'))).toBe(true);
  });

  it('returns the organisation-wide weighted-average inventory cost method', () => {
    const results = retrieveAssistantKnowledge({
      query: 'What kind of inventory cost system does Solvantis use?',
      audience: 'ims',
    });
    expect(results.some(result => result.title === 'Inventory Costing and Stock Value')).toBe(true);
    expect(results.some(result => result.content.includes('organisation-wide weighted-average cost'))).toBe(true);
    expect(results.some(result => result.content.includes('not FIFO or LIFO'))).toBe(true);
  });

  it('recognizes WAC and COGS inventory terminology', () => {
    const results = retrieveAssistantKnowledge({
      query: 'Does WAC feed COGS and stock valuation?',
      audience: 'ims',
    });
    const costing = results.find(result => result.title === 'Inventory Costing and Stock Value' && result.content.includes('fallback cost of goods sold'));
    expect(costing?.content).toContain('fallback cost of goods sold');
    expect(costing?.content).toContain('inventory valuation');
  });

  it('keeps wholesale account ownership guidance within wholesale results', () => {
    const results = retrieveAssistantKnowledge({
      query: 'Can I see another company location order?',
      audience: 'wholesale',
    });
    expect(results.some(result => result.title === 'Wholesale Portal' && result.heading === 'Account')).toBe(true);
  });

  it('returns no results for an empty query', () => {
    expect(retrieveAssistantKnowledge({ query: ' ', audience: 'ims' })).toEqual([]);
  });
});