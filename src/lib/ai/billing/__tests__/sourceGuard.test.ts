import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap(name => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesUnder(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('AI generation source guard', () => {
  it('keeps provider generation behind the tracked gateway', () => {
    const sourceRoot = join(process.cwd(), 'src');
    const violations = filesUnder(sourceRoot).flatMap(path => {
      const normalized = relative(process.cwd(), path).replaceAll('\\', '/');
      if (normalized === 'src/lib/ai/billing/googleGateway.ts') return [];
      if (normalized.includes('/__tests__/')) return [];
      const source = readFileSync(path, 'utf8');
      return /new\s+Google(?:GenAI|GenerativeAI)|generativelanguage\.googleapis\.com[^\n]*:generateContent/.test(source) ? [normalized] : [];
    });
    expect(violations).toEqual([]);
  });
});