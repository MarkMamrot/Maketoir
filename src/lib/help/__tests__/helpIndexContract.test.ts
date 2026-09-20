import { describe, expect, it } from 'vitest';

import assistantIndex from '@/generated/solvantis-assistant-index.json';
import helpIndex from '@/generated/solvantis-help-index.json';

const topics = helpIndex.topics;

describe('generated Help presentation contract', () => {
  it('gives every topic a small valid set of default-open sections', () => {
    expect(topics).toHaveLength(68);
    for (const topic of topics) {
      expect(topic.quickSections.length, topic.id).toBeGreaterThanOrEqual(1);
      expect(topic.quickSections.length, topic.id).toBeLessThanOrEqual(4);
      expect(topic.sections.filter(section => section.presentation === 'quick').map(section => section.heading).sort()).toEqual([...topic.quickSections].sort());
      expect(topic.sections.every(section => section.presentation === 'quick' || section.presentation === 'detail')).toBe(true);
    }
  });

  it('keeps supplemental Assistant chunks linked to real parent Help sections', () => {
    const sectionIds = new Set(topics.flatMap(topic => topic.sections.map(section => section.id)));
    const supplemental = assistantIndex.chunks.filter(chunk => chunk.id !== chunk.sectionId);

    expect(supplemental.length).toBeGreaterThan(0);
    expect(supplemental.every(chunk => sectionIds.has(chunk.sectionId))).toBe(true);
    expect(supplemental.some(chunk => chunk.heading.includes(' > '))).toBe(true);
  });
});
