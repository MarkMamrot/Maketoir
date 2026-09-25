import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const LEGACY_CALL_SITES = {
  explicit_instance_selection: [
  ],
  mapping_fan_out: [],
  owned_record: [],
} as const;

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap(name => {
    const absolutePath = path.join(root, name);
    if (statSync(absolutePath).isDirectory()) return sourceFiles(absolutePath);
    return /\.(?:ts|tsx)$/.test(name) ? [absolutePath] : [];
  });
}

describe('legacy Shopify credential migration manifest', () => {
  it('contains every remaining runtime caller and rejects new default-store usage', () => {
    const sourceRoot = path.join(process.cwd(), 'src');
    const actual = sourceFiles(sourceRoot)
      .filter(filePath => !filePath.endsWith(path.join('lib', 'shopifyCredentials.ts')))
      .filter(filePath => /getShopifyAdminCredentials\s*\(/.test(readFileSync(filePath, 'utf8')))
      .map(filePath => path.relative(sourceRoot, filePath).replaceAll('\\', '/'))
      .sort();
    const expected = Object.values(LEGACY_CALL_SITES).flat().sort();

    expect(actual).toEqual([]);
    expect(expected).toEqual([]);
  });
});