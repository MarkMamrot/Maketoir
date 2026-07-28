import { describe, expect, it } from 'vitest';
import { compileLearnedMarkdown } from '../learningCurator';

describe('customer-service learned Markdown', () => {
  it('replaces the managed section instead of appending duplicates', () => {
    const first = compileLearnedMarkdown('# Style\nManual rule.', [{ rule_key: 'short', title: 'Be concise', proposed_markdown: 'Keep replies short.' }], 800);
    const second = compileLearnedMarkdown(first, [{ rule_key: 'warm', title: 'Warm tone', proposed_markdown: 'Use a warm greeting.' }], 800);
    expect(second).not.toContain('Keep replies short.');
    expect(second.match(/<!-- learned:start -->/g)).toHaveLength(1);
    expect(second).toContain('Use a warm greeting.');
  });

  it('does not exceed the document word cap', () => {
    const result = compileLearnedMarkdown('# Style', [
      { rule_key: 'too-long', title: 'Long rule', proposed_markdown: Array(20).fill('word').join(' ') },
    ], 10);
    expect(result.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(10);
  });
});