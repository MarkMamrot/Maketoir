import { describe, expect, it } from 'vitest';

import type { HelpTopic } from '../types';
import { searchHelpTopics } from '../searchHelpTopics';

const topic = {
  id: 'returns', title: 'Returns', summary: 'Return customer goods', audiences: ['ims'],
  capability: 'orders', screen: 'Sales', product: 'ims', contexts: ['returns'], owner: 'sales',
  lastReviewed: '2026-08-23', filename: 'returns.md', sections: [
    { id: 'returns:1', heading: 'Refunds', content: 'Complete the linked **credit note** once, then review the refund.' },
  ],
} satisfies HelpTopic;

describe('searchHelpTopics', () => {
  it('matches section body text and returns a readable Markdown-free snippet', () => {
    const [result] = searchHelpTopics([topic], 'credit note');
    expect(result).toMatchObject({ topic: { id: 'returns' }, section: { id: 'returns:1' } });
    expect(result.snippet).toContain('linked credit note once');
    expect(result.snippet).not.toContain('**');
  });

  it('returns no results for an empty query', () => {
    expect(searchHelpTopics([topic], '  ')).toEqual([]);
  });
});