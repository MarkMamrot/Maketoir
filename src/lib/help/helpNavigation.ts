import type { HelpProduct, HelpTopic } from './types';

export const HELP_SECTION_ORDER = ['ims', 'intel-automation', 'pos', 'wholesale', 'setup', 'reference'] as const;

export type HelpSectionId = typeof HELP_SECTION_ORDER[number];

const PRODUCT_SECTIONS: Record<HelpProduct, { id: HelpSectionId; label: string }> = {
  ims: { id: 'ims', label: 'IMS' },
  dashboard: { id: 'intel-automation', label: 'Intel & Automation' },
  foresight: { id: 'intel-automation', label: 'Intel & Automation' },
  pos: { id: 'pos', label: 'POS' },
  wholesale: { id: 'wholesale', label: 'Wholesale' },
  setup: { id: 'setup', label: 'Setup' },
  shared: { id: 'reference', label: 'Reference' },
};

export function helpSectionForProduct(product: HelpProduct) {
  return PRODUCT_SECTIONS[product];
}

export function initialHelpSection(topic?: HelpTopic | null): HelpSectionId[] {
  return topic ? [helpSectionForProduct(topic.product).id] : [];
}

export function groupHelpTopics(topics: HelpTopic[]) {
  const groups = new Map<HelpSectionId, { id: HelpSectionId; label: string; topics: HelpTopic[] }>();
  for (const topic of topics) {
    const section = helpSectionForProduct(topic.product);
    const group = groups.get(section.id);
    if (group) group.topics.push(topic);
    else groups.set(section.id, { ...section, topics: [topic] });
  }
  return HELP_SECTION_ORDER.flatMap(sectionId => {
    const group = groups.get(sectionId);
    return group ? [group] : [];
  });
}