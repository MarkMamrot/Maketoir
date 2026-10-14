import { describe, expect, it } from 'vitest';

import { groupHelpTopics, HELP_CATEGORIES, helpTopicBreadcrumb, helpTopicPath } from '../helpNavigation';
import { listHelpLibraryTopics } from '../resolveHelpContext';
import type { HelpNavigationEntry, HelpNavigationGroup } from '../helpNavigation';
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
    navigation: { category: product === 'pos' ? 'pos' : product === 'shared' ? 'reference' : 'products', label: id },
    contexts: [id],
    quickSections: [],
    owner: id,
    lastReviewed: '2026-08-29',
    filename: `${id}.md`,
    sections: [],
  };
}

describe('Help navigation', () => {
  it('groups available topics by workflow in stable category order and omits empty categories', () => {
    const groups = groupHelpTopics([
      topic('reference', 'shared'),
      topic('automation', 'foresight'),
      topic('checkout', 'pos'),
      topic('inventory', 'ims'),
    ]);

    expect(groups.map(group => group.label)).toEqual(['Products', 'POS', 'Troubleshooting & Glossary']);
    expect(groups[0].children.map(item => item.id)).toEqual(['automation', 'inventory']);
  });

  it('returns exactly the category and subgroup ancestors of a contextual topic', () => {
    const checkout = topic('checkout', 'pos');
    checkout.navigation.subgroup = 'Selling & customer value';
    expect(helpTopicPath(topic('inventory', 'ims'))).toEqual(['products']);
    expect(helpTopicPath(checkout)).toEqual(['pos', 'pos:Selling & customer value']);
    expect(helpTopicBreadcrumb(checkout)).toBe('POS > Selling & customer value');
    expect(helpTopicPath(null)).toEqual([]);
  });

  it('includes section shortcuts without nesting the whole article hierarchy', () => {
    const catalogue = topic('catalogue', 'ims');
    catalogue.sections = [{ id: 'catalogue:brands', heading: 'Brands', content: 'Manage brands', presentation: 'detail' }];
    catalogue.navigation.sections = [{ heading: 'Brands', label: 'Manage brands' }];
    expect(groupHelpTopics([catalogue])[0].children).toEqual([
      expect.objectContaining({ id: 'catalogue', label: 'catalogue', topic: catalogue }),
      expect.objectContaining({ label: 'Manage brands', topic: catalogue, sectionId: 'catalogue:brands' }),
    ]);
    catalogue.navigation.sections[0].heading = 'Missing';
    expect(() => groupHelpTopics([catalogue])).toThrow('invalid navigation section');
  });

  it('gives every available topic exactly one article destination and valid section destinations', () => {
    const topics = listHelpLibraryTopics('ims', 'ims', undefined, 'SuperAdmin');
    const groups = groupHelpTopics(topics);
    const entries = (nodes: Array<HelpNavigationEntry | HelpNavigationGroup>): HelpNavigationEntry[] =>
      nodes.flatMap(node => 'topic' in node ? [node] : entries(node.children));
    const destinations = entries(groups);
    expect(destinations.filter(entry => !entry.sectionId).map(entry => entry.topic.id).sort()).toEqual(topics.map(item => item.id).sort());
    expect(new Set(destinations.map(entry => entry.id)).size).toBe(destinations.length);
    expect(groups.map(group => group.id)).toEqual(Object.keys(HELP_CATEGORIES).filter(id => topics.some(item => item.navigation.category === id)));
    for (const entry of destinations.filter(item => item.sectionId)) {
      expect(entry.topic.sections.some(section => section.id === entry.sectionId)).toBe(true);
    }
  });

  it('keeps navigation destinations valid when accounting content is filtered out', () => {
    expect(() => groupHelpTopics(listHelpLibraryTopics('ims', 'ims', false))).not.toThrow();
  });
});