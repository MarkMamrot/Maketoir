import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceExtensions = /\.(?:ts|tsx|js|mjs|cjs)$/;
const ignoredDirectories = new Set([
  '.git',
  'build',
  'coverage',
  'customers',
  'dist',
  'generated',
  'images',
  'node_modules',
  'public',
  'test-results',
  'tmp',
]);

function sourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignoredDirectories.has(entry.name) || entry.name.startsWith('.next')) return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return sourceExtensions.test(entry.name) ? [fullPath] : [];
  });
}

function sqlStrings(source: string): string[] {
  const sourceFile = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const strings: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      strings.push(node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      strings.push(node.getText(sourceFile).slice(1, -1));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return strings.filter(value => /\b(?:SELECT|UPDATE|INSERT|FROM|JOIN)\b/i.test(value));
}

describe('stock Average Cost ownership contract', () => {
  it('keeps current Average Cost reads and writes on product variants', () => {
    const violations: string[] = [];

    for (const filePath of sourceFiles(process.cwd())) {
      if (filePath === __filename) continue;
      const relativePath = path.relative(process.cwd(), filePath);
      const source = fs.readFileSync(filePath, 'utf8');

      if (/\bims_stock\.avg_cost\b/i.test(source)) {
        violations.push(`${relativePath}: names ims_stock.avg_cost`);
      }
      if (!/\bims_stock\b/i.test(source)) continue;

      for (const sql of sqlStrings(source)) {
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

  it('defines Average Cost only on product variants in the canonical schema', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'scripts', 'ims-schema.sql'), 'utf8');
    const stockTable = schema.match(/CREATE TABLE IF NOT EXISTS ims_stock \([\s\S]*?\n\) ENGINE=/)?.[0];
    const variantTable = schema.match(/CREATE TABLE IF NOT EXISTS ims_product_variants \([\s\S]*?\n\) ENGINE=/)?.[0];

    expect(stockTable).toBeDefined();
    expect(stockTable).not.toMatch(/\bavg_cost\b/i);
    expect(variantTable).toMatch(/\bavg_cost\b/i);
  });
});