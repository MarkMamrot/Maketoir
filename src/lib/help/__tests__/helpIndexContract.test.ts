import { describe, expect, it } from 'vitest';

import assistantIndex from '@/generated/solvantis-assistant-index.json';
import helpIndex from '@/generated/solvantis-help-index.json';
import { HELP_CATEGORIES } from '../helpNavigation';

const topics = helpIndex.topics;

describe('generated Help presentation contract', () => {
  it('validates canonical navigation categories, section destinations and platform visibility', () => {
    for (const topic of topics) {
      expect(Object.keys(HELP_CATEGORIES), topic.id).toContain(topic.navigation.category);
      expect(topic.navigation.label.trim(), topic.id).not.toBe('');
      if ('sections' in topic.navigation) {
        for (const shortcut of topic.navigation.sections ?? []) {
          expect(topic.sections.some(section => section.heading === shortcut.heading), topic.id).toBe(true);
        }
      }
      if (topic.navigation.category === 'platform') {
        expect('requiredTier' in topic && topic.requiredTier, topic.id).toBe('SuperAdmin');
      }
    }
  });
  it('keeps shared Help and Assistant content free of known tenant-specific names', () => {
    const tenantNames = /\b(?:Kotara|Monsterthreads|Newtown|QVB|Bondi|St Peters|Sage)\b/i;
    for (const topic of topics) {
      expect(JSON.stringify(topic), topic.id).not.toMatch(tenantNames);
    }
    for (const chunk of assistantIndex.chunks) {
      expect(JSON.stringify(chunk), chunk.id).not.toMatch(tenantNames);
    }
  });

  it('gives every topic a small valid set of default-open sections', () => {
    expect(topics).toHaveLength(75);
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
