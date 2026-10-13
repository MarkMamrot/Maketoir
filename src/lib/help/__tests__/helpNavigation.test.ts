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
    quickSections: [],
    owner: id,
    lastReviewed: '2026-08-29',
    filename: `${id}.md`,
    sections: [],
  };
}

describe('Help navigation', () => {
  it('combines legacy dashboard and Foresight topics under IMS', () => {
    expect(helpSectionForProduct('dashboard')).toEqual({ id: 'ims', label: 'IMS' });
    expect(helpSectionForProduct('foresight')).toEqual({ id: 'ims', label: 'IMS' });
  });

  it('groups available topics in stable product order and omits empty sections', () => {
    const groups = groupHelpTopics([
      topic('reference', 'shared'),
      topic('automation', 'foresight'),
      topic('setup', 'setup'),
      topic('inventory', 'ims'),
    ]);

    expect(groups.map(group => group.label)).toEqual(['IMS', 'Setup', 'Reference']);
    expect(groups[0].topics.map(item => item.id)).toEqual(['automation', 'inventory']);
  });

  it('initially expands only the section containing the contextual topic', () => {
    expect(initialHelpSection(topic('inventory', 'ims'))).toEqual(['ims']);
    expect(initialHelpSection(topic('automation', 'foresight'))).toEqual(['ims']);
    expect(initialHelpSection(null)).toEqual([]);
  });
});