import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  IMS_SCHEMA_REQUIRED_COLUMNS,
  IMS_SCHEMA_REQUIRED_INDEXES,
  IMS_SCHEMA_REQUIRED_TABLES,
} from '../schemaContract';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'scripts', 'ims-schema.sql'), 'utf8');
const catchupSource = fs.readFileSync(path.join(process.cwd(), 'scripts', 'catchup-schema-all-tenants.mjs'), 'utf8');

function tableBody(table: string): string {
  const match = schemaSql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\) ENGINE=`, 'i'));
  if (!match) throw new Error(`Missing CREATE TABLE for ${table}`);
  return match[1];
}

function declaredColumns(body: string): Set<string> {
  const nonColumnKeywords = new Set(['PRIMARY', 'UNIQUE', 'INDEX', 'KEY', 'FOREIGN', 'CONSTRAINT', 'CHECK']);
  return new Set(
    body
      .split('\n')
      .map(line => {
        const match = line.trim().match(/^`([^`]+)`\s+|^([a-zA-Z0-9_]+)\s+/);
        return match?.[1] ?? (
          match?.[2] && !nonColumnKeywords.has(match[2].toUpperCase()) ? match[2] : undefined
        );
      })
      .filter((column): column is string => Boolean(column)),
  );
}

function manifestPairs(sectionStart: string, sectionEnd: string): Array<[string, string]> {
  const start = catchupSource.indexOf(sectionStart);
  const end = catchupSource.indexOf(sectionEnd, start);
  if (start < 0 || end < 0) throw new Error(`Missing catch-up manifest section ${sectionStart}`);
  return Array.from(catchupSource.slice(start, end).matchAll(/\['([^']+)',\s*'([^']+)'/g))
    .map(match => [match[1], match[2]]);
}

describe('fresh IMS schema contract', () => {
  it('declares every required tenant table exactly once', () => {
    const declaredTables = Array.from(schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)\s*\(/gi))
      .map(match => match[1]);
    expect(new Set(declaredTables).size).toBe(declaredTables.length);
    expect([...declaredTables].sort()).toEqual([...IMS_SCHEMA_REQUIRED_TABLES].sort());
  });

  it('declares every runtime-required additive column', () => {
    for (const [table, requiredColumns] of Object.entries(IMS_SCHEMA_REQUIRED_COLUMNS)) {
      const columns = declaredColumns(tableBody(table));
      for (const column of requiredColumns) expect(columns.has(column), `${table}.${column}`).toBe(true);
    }
  });

  it('declares required indexes after their columns', () => {
    for (const [table, requiredIndexes] of Object.entries(IMS_SCHEMA_REQUIRED_INDEXES)) {
      const body = tableBody(table);
      const columns = declaredColumns(body);
      for (const indexName of requiredIndexes) {
        const index = body.match(new RegExp(`(?:UNIQUE\\s+)?(?:KEY|INDEX)\\s+${indexName}\\s*\\(([^)]+)\\)`, 'i'));
        expect(index, `${table}.${indexName}`).not.toBeNull();
        for (const rawColumn of index?.[1].split(',') ?? []) {
          const column = rawColumn.trim().replace(/`/g, '').split(/\s+/)[0];
          expect(columns.has(column), `${table}.${indexName} -> ${column}`).toBe(true);
        }
      }
    }
  });

  it('already contains every additive catch-up column and index', () => {
    const missing: string[] = [];
    for (const [table, column] of manifestPairs('const COLUMNS = [', 'const INDEXES = [')) {
      if (!declaredColumns(tableBody(table)).has(column)) missing.push(`${table}.${column}`);
    }
    for (const [table, index] of manifestPairs('const INDEXES = [', 'async function ensureEnumValues')) {
      if (!new RegExp(`(?:KEY|INDEX)\\s+${index}\\s*\\(`, 'i').test(tableBody(table))) {
        missing.push(`${table}.${index}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('does not define indexes or foreign keys on undeclared columns', () => {
    const tables = Array.from(schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)\s*\(/gi))
      .map(match => match[1]);
    expect(tables.length).toBeGreaterThan(50);

    const invalidReferences: string[] = [];
    for (const table of tables) {
      const body = tableBody(table);
      const columns = declaredColumns(body);
      const constraintLines = body.split('\n').map(line => line.trim()).filter(line =>
        /^(?:PRIMARY KEY|(?:UNIQUE\s+)?(?:KEY|INDEX)\s+|FOREIGN KEY)/i.test(line),
      );
      for (const line of constraintLines) {
        const reference = line.match(/\((.*)\)/);
        if (!reference) continue;
        for (const rawColumn of reference[1].split(',')) {
          const identifier = rawColumn.trim().match(/^`([^`]+)`|^([a-zA-Z_][a-zA-Z0-9_]*)/);
          const column = identifier?.[1] ?? identifier?.[2] ?? '';
          if (!columns.has(column)) invalidReferences.push(`${table}.${column}`);
        }
      }
    }
    expect(invalidReferences).toEqual([]);
  });
});