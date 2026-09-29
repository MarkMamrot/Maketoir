import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(entryPath);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

describe('purchase order item ownership writers', () => {
  it('tenant-stamps every production purchase-order line insert', () => {
    const missingOwnership: string[] = [];
    const insertPattern = /INSERT INTO ims_purchase_order_items\s*\(([^)]*)\)/gi;

    for (const file of sourceFiles(path.join(process.cwd(), 'src'))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(insertPattern)) {
        if (!/\bbusiness_id\b/i.test(match[1])) missingOwnership.push(path.relative(process.cwd(), file));
      }
    }

    expect(missingOwnership).toEqual([]);
  });
});