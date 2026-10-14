import type { HelpCategory, HelpTopic } from './types';

export const HELP_CATEGORIES: Record<HelpCategory, string> = {
  'getting-started': 'Getting started',
  products: 'Products',
  sales: 'Sales',
  purchasing: 'Purchasing',
  contacts: 'Contacts',
  'locations-stock': 'Locations & Stock',
  finances: 'Finances',
  reports: 'Reports',
  integrations: 'Integrations',
  automations: 'Automations',
  settings: 'Settings & Setup',
  pos: 'POS',
  wholesale: 'Wholesale',
  reference: 'Troubleshooting & Glossary',
  platform: 'Platform administration',
};

export interface HelpNavigationEntry {
  id: string;
  label: string;
  topic: HelpTopic;
  sectionId?: string;
}

export interface HelpNavigationGroup {
  id: string;
  label: string;
  children: Array<HelpNavigationGroup | HelpNavigationEntry>;
}

export function helpTopicPath(topic?: HelpTopic | null): string[] {
  if (!topic) return [];
  const { category, subgroup } = topic.navigation;
  return subgroup ? [category, `${category}:${subgroup}`] : [category];
}

export function helpTopicBreadcrumb(topic: HelpTopic): string {
  return [HELP_CATEGORIES[topic.navigation.category], topic.navigation.subgroup].filter(Boolean).join(' > ');
}

export function groupHelpTopics(topics: HelpTopic[]): HelpNavigationGroup[] {
  const groups = new Map<HelpCategory, HelpNavigationGroup>();
  for (const topic of topics) {
    const { category, label, subgroup, sections } = topic.navigation;
    let group = groups.get(category);
    if (!group) {
      group = { id: category, label: HELP_CATEGORIES[category], children: [] };
      groups.set(category, group);
    }
    if (subgroup) {
      const subgroupId = `${category}:${subgroup}`;
      let childGroup = group.children.find((child): child is HelpNavigationGroup => !('topic' in child) && child.id === subgroupId);
      if (!childGroup) {
        childGroup = { id: subgroupId, label: subgroup, children: [] };
        group.children.push(childGroup);
      }
      group = childGroup;
    }
    group.children.push({ id: topic.id, label, topic });
    for (const shortcut of sections ?? []) {
      const section = topic.sections.find(candidate => candidate.heading === shortcut.heading);
      if (!section) throw new Error(`Help topic ${topic.id} has an invalid navigation section: ${shortcut.heading}`);
      group.children.push({ id: `${topic.id}:${section.id}`, label: shortcut.label, topic, sectionId: section.id });
    }
  }
  return (Object.keys(HELP_CATEGORIES) as HelpCategory[]).flatMap(category => {
    const group = groups.get(category);
    return group ? [group] : [];
  });
}