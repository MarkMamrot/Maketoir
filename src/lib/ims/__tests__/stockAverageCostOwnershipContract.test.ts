import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceExtensions = /\.(?:ts|tsx|js|mjs|cjs)$/;

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'generated' || entry.name === 'node_modules') return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return sourceExtensions.test(entry.name) ? [fullPath] : [];
  });
}

function sqlTemplates(source: string): string[] {
  return Array.from(source.matchAll(/`([\s\S]*?)`/g), match => match[1]);
}

describe('stock Average Cost ownership contract', () => {
  it('keeps current Average Cost reads and writes on product variants', () => {
    const roots = ['src', 'scripts', 'e2e'].map(root => path.join(process.cwd(), root));
    const violations: string[] = [];

    for (const filePath of roots.flatMap(sourceFiles)) {
      if (filePath === __filename) continue;
      const relativePath = path.relative(process.cwd(), filePath);
      const source = fs.readFileSync(filePath, 'utf8');

      for (const sql of sqlTemplates(source)) {
        const stockAliases = Array.from(
          sql.matchAll(/(?:FROM|JOIN)\s+(?:\$\{[^}]+\}\.)?ims_stock\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/gi),
          match => match[1],
        );
        for (const alias of stockAliases) {
          if (new RegExp(`\\b${alias}\\.avg_cost\\b`, 'i').test(sql)) {
            violations.push(`${relativePath}: reads ${alias}.avg_cost`);
          }
          if (new RegExp(`SELECT[\\s\\S]*?\\b${alias}\\.\\*`, 'i').test(sql)) {
            violations.push(`${relativePath}: selects ${alias}.* from ims_stock`);
          }
        }

        if (/\bims_stock\.avg_cost\b/i.test(sql)) {
          violations.push(`${relativePath}: reads ims_stock.avg_cost`);
        }
        if (/UPDATE\s+(?:\$\{[^}]+\}\.)?ims_stock(?:\s+[a-zA-Z_][a-zA-Z0-9_]*)?\s+SET[\s\S]*?\bavg_cost\b/i.test(sql)) {
          violations.push(`${relativePath}: writes ims_stock.avg_cost`);
        }
        if (/INSERT\s+(?:IGNORE\s+)?INTO\s+(?:\$\{[^}]+\}\.)?ims_stock\s*\([^)]*\bavg_cost\b/i.test(sql)) {
          violations.push(`${relativePath}: inserts ims_stock.avg_cost`);
        }
        if (/SELECT\s+\*\s+FROM\s+(?:\$\{[^}]+\}\.)?ims_stock\b/i.test(sql)) {
          violations.push(`${relativePath}: selects every ims_stock column`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});