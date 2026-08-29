import { describe, expect, it } from 'vitest';

import { groupHelpTopics, helpSectionForProduct, initialHelpSection } from '../helpNavigation';
import type { HelpProduct, HelpTopic } from '../types';

function topic(id: string, product: HelpProduct): HelpTopic {
  return {
    id,
    title: id,
    summary: id,
    audiences: ['ims'],
    capability: 'navigation',
    screen: id,
    product,
    contexts: [id],
    owner: id,
    lastReviewed: '2026-08-29',
    filename: `${id}.md`,
    sections: [],
  };
}

describe('Help navigation', () => {
  it('combines dashboard and Foresight topics under Intel & Automation', () => {
    expect(helpSectionForProduct('dashboard')).toEqual({ id: 'intel-automation', label: 'Intel & Automation' });
    expect(helpSectionForProduct('foresight')).toEqual({ id: 'intel-automation', label: 'Intel & Automation' });
  });

  it('groups available topics in stable product order and omits empty sections', () => {
    const groups = groupHelpTopics([
      topic('reference', 'shared'),
      topic('automation', 'foresight'),
      topic('setup', 'setup'),
      topic('inventory', 'ims'),
    ]);

    expect(groups.map(group => group.label)).toEqual(['IMS', 'Intel & Automation', 'Setup', 'Reference']);
    expect(groups[1].topics.map(item => item.id)).toEqual(['automation']);
  });

  it('initially expands only the section containing the contextual topic', () => {
    expect(initialHelpSection(topic('inventory', 'ims'))).toEqual(['ims']);
    expect(initialHelpSection(topic('automation', 'foresight'))).toEqual(['intel-automation']);
    expect(initialHelpSection(null)).toEqual([]);
  });
});