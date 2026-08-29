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
      currentView: 'sales-orders',
    });
    expect(result).toEqual(expect.objectContaining({
      title: 'Sales Orders and Fulfilment',
      heading: 'Step-by-step',
      screen: 'Sales > Sales Orders',
      topicId: 'ims-sales-orders-fulfilment',
    }));
  });

  it('returns the exact purchase-order navigation section', () => {
    const [result] = retrieveAssistantKnowledge({
      query: 'Where is the purchase order screen?',
      audience: 'ims',
      currentView: 'purchase-orders',
    });
    expect(result).toEqual(expect.objectContaining({
      title: 'Purchase Orders',
      screen: 'Purchasing > Purchase Orders',
    }));
    expect(result.content).toContain('purchase order records what you intend to buy');
    expect(result.topicId).toBe('ims-purchase-orders');
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
    expect(timing?.content).toContain('not posted one by one at checkout');
    expect(timing?.content).toContain('configured EOD process');
  });

  it('excludes every Xero-bearing chunk when tenant accounting is disabled', () => {
    const results = retrieveAssistantKnowledge({
      query: 'How do Xero syncs work for purchase orders and POS?',
      audience: 'ims',
      xeroAccountingEnabled: false,
    });
    expect(results.every(result => !/\bxero\b/i.test(JSON.stringify(result)))).toBe(true);
  });

  it('explains Shopify Misc Charge as an unmatched variant fallback', () => {
    const results = retrieveAssistantKnowledge({
      query: 'Why does my online order have Shopify Misc Charge in IMS?',
      audience: 'ims',
      currentView: 'online-sales',
    });
    const explanation = results.find(result => result.heading === 'POS and online sales');
    expect(explanation?.content).toContain('not an added fee');
    expect(explanation?.content).toContain('cannot be matched to an IMS variant');
    expect(results.some(result => result.title === 'Shopify Sync and Product Mapping')).toBe(true);
  });

  it('does not retrieve Shopify knowledge when Shopify is disabled', () => {
    const results = retrieveAssistantKnowledge({
      query: 'How do I sync and map Shopify products?',
      audience: 'ims',
      availableCapabilities: { xero: true, shopify: false, native_shop: true },
    });
    expect(results.some(result => result.title === 'Shopify Sync and Product Mapping')).toBe(false);
  });

  it('does not retrieve Native Shop knowledge when Native Shop is disabled', () => {
    const results = retrieveAssistantKnowledge({
      query: 'How do I publish the Online Shop storefront?',
      audience: 'ims',
      availableCapabilities: { xero: true, shopify: true, native_shop: false },
    });
    expect(results.some(result => result.title === 'Online Shop')).toBe(false);
  });

  it('returns the organisation-wide weighted-average inventory cost method', () => {
    const results = retrieveAssistantKnowledge({
      query: 'What kind of inventory cost system does Solvantis use?',
      audience: 'ims',
    });
    expect(results.some(result => result.title === 'Inventory Costing and Stock Value')).toBe(true);
    expect(results.some(result => result.content.includes('one organisation-wide weighted-average cost for each variant'))).toBe(true);
    expect(results.some(result => result.content.includes('not separate FIFO or LIFO cost layers'))).toBe(true);
  });

  it('recognizes WAC and COGS inventory terminology', () => {
    const results = retrieveAssistantKnowledge({
      query: 'Does WAC feed COGS and stock valuation?',
      audience: 'ims',
    });
    const costing = results.find(result => result.title === 'Inventory Costing and Stock Value' && result.heading === 'Main operations');
    expect(costing?.content).toContain('historical margin and cost of goods sold (COGS)');
    expect(costing?.content).toContain("today's inventory valuation");
  });

  it('keeps wholesale account ownership guidance within wholesale results', () => {
    const results = retrieveAssistantKnowledge({
      query: 'Can I see another company location order?',
      audience: 'wholesale',
    });
    expect(results.some(result => result.title === 'Team, Locations, and Permissions')).toBe(true);
    expect(results.some(result => result.content.includes('assigned buying locations'))).toBe(true);
  });

  it('finds the plain-language return guide from old ownership wording', () => {
    const results = retrieveAssistantKnowledge({
      query: 'Customer Credit Notes owns manual IMS returns and the linked credit note is the sole return stock owner. What does that mean?',
      audience: 'ims',
      currentView: 'credit-notes',
    });
    expect(results[0]).toEqual(expect.objectContaining({ title: 'Customer Returns, Store Credit, and Refunds' }));
    expect(results.some(result => result.content.includes('What adds stock back once'))).toBe(true);
  });

  it('explains wholesale indent as approved pre-order quantity', () => {
    const results = retrieveAssistantKnowledge({
      query: 'What does indent mean and can I order more than is in stock?',
      audience: 'wholesale',
      currentView: 'catalogue',
    });
    expect(results[0]).toEqual(expect.objectContaining({
      title: 'Ordering, Saved Lists, and Stock Rules',
      heading: 'Stock and indent decisions',
    }));
    expect(results[0].content).toContain('approved that product for pre-order beyond current available stock');
  });

  it('returns no results for an empty query', () => {
    expect(retrieveAssistantKnowledge({ query: ' ', audience: 'ims' })).toEqual([]);
  });
});