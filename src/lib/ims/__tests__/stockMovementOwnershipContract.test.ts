import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function productionSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__' || entry.name === 'generated') return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(fullPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

describe('stock movement ownership contract', () => {
  it('requires business_id in every production movement insert', () => {
    const sourceRoot = path.join(process.cwd(), 'src');
    const insertPattern = /INSERT\s+(?:IGNORE\s+)?INTO\s+ims_stock_movements\s*\(([\s\S]*?)\)\s*VALUES/gi;
    const omissions: string[] = [];
    let insertCount = 0;

    for (const filePath of productionSourceFiles(sourceRoot)) {
      const source = fs.readFileSync(filePath, 'utf8');
      for (const match of source.matchAll(insertPattern)) {
        insertCount += 1;
        const columns = match[1].split(',').map(column => column.trim().replaceAll('`', '').toLowerCase());
        if (!columns.includes('business_id')) omissions.push(path.relative(process.cwd(), filePath));
      }
    }

    expect(insertCount).toBeGreaterThan(0);
    expect(omissions).toEqual([]);
  });
});
