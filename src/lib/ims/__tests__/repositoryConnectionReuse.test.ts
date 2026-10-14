import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = ts.createSourceFile('ImsRepository.ts', readFileSync(resolve('src', 'lib', 'ims', 'ImsRepository.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
function methodSource(repository: string, name: string): string {
  let found: ts.MethodDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === repository
      && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      found = node.initializer.properties.find((property): property is ts.MethodDeclaration =>
        ts.isMethodDeclaration(property) && property.name.getText(source) === name);
    }
    if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw new Error(`${repository}.${name} was not found.`);
  return ts.transpileModule(found.getText(source).replace(`async ${name}(`, `async function ${name}(`),
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
}

describe('repository connection reuse', () => {
  it('creates five populated stocktakes with only five pool slots and no nested borrowing', async () => {
    let busy = 0;
    let sequence = 0;
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const pool = {
      getConnection: vi.fn(async () => {
        if (busy >= 5) throw new Error('A sixth connection cannot be borrowed.');
        busy++;
        const release = vi.fn(() => { busy--; });
        releases.push(release);
        return {
          release, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(),
          execute: vi.fn(async (sql: string) => sql.includes('INSERT INTO ims_stocktakes')
            ? [{ insertId: ++sequence }] : sql.includes('SELECT v.variant_id')
            ? [[{ variant_id: 'variant-1', qty_on_hand: 4 }]] : [{ affectedRows: 1 }]),
        };
      }),
    };
    const imsQuery = vi.fn(async () => {
      const connection = await pool.getConnection();
      connection.release();
      return [{ variant_id: 'variant-1', qty_on_hand: 4 }];
    });
    const create: (data: { reference: string; location_id: number }, businessId: string) => Promise<number>
      = runInNewContext(`${methodSource('ImsStocktakeRepo', 'create')};create;`, {
        ensureStocktakeTenantTables: vi.fn(), getIMSPool: () => pool,
        stockOnHandCondition: () => null, imsQuery,
      });
    expect(await Promise.all(Array.from({ length: 5 }, (_, index) => create({ reference: `Count-${index}`, location_id: 1 }, 'tenant-a'))))
      .toEqual([1, 2, 3, 4, 5]);
    expect(imsQuery).not.toHaveBeenCalled();
    expect(pool.getConnection).toHaveBeenCalledTimes(5);
    expect(releases.every(release => release.mock.calls.length === 1)).toBe(true);
    expect(busy).toBe(0);
  });

  it.each(['ImsPORepo', 'ImsBTRepo'])('does not make direct pool reads inside %s.changeStatus', repository => {
    expect(methodSource(repository, 'changeStatus')).not.toMatch(/await imsQuery(?:<|\()/);
  });
});
