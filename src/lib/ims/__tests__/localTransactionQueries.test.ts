import type { PoolConnection } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));

import { localTransactionQueries } from '../localTransactionQueries';

describe('localTransactionQueries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves legacy helper reads and writes when no connection is supplied', async () => {
    mocks.query.mockResolvedValue([{ id: 3 }]);
    mocks.execute.mockResolvedValue({ insertId: 4 });
    const queries = localTransactionQueries();
    await expect(queries.query<{ id: number }>('SELECT id', ['tenant'])).resolves.toEqual([{ id: 3 }]);
    await expect(queries.execute('INSERT INTO test VALUES (?)', [4])).resolves.toEqual({ insertId: 4 });
    expect(mocks.query).toHaveBeenCalledWith('SELECT id', ['tenant']);
    expect(mocks.execute).toHaveBeenCalledWith('INSERT INTO test VALUES (?)', [4]);
  });

  it('uses only the exact supplied connection for reads and writes', async () => {
    const execute = vi.fn().mockResolvedValueOnce([[{ id: 3 }], []]).mockResolvedValueOnce([{ insertId: 4 }, []]);
    const connection = { execute } as unknown as PoolConnection;
    const queries = localTransactionQueries(connection);
    await expect(queries.query<{ id: number }>('SELECT id', ['tenant'])).resolves.toEqual([{ id: 3 }]);
    await expect(queries.execute('INSERT INTO test VALUES (?)', [4])).resolves.toEqual({ insertId: 4 });
    expect(execute).toHaveBeenNthCalledWith(1, 'SELECT id', ['tenant']);
    expect(execute).toHaveBeenNthCalledWith(2, 'INSERT INTO test VALUES (?)', [4]);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('propagates caller connection failures without fallbacks', async () => {
    const error = new Error('Deadlock');
    const connection = { execute: vi.fn().mockRejectedValue(error) } as unknown as PoolConnection;
    await expect(localTransactionQueries(connection).query('SELECT 1')).rejects.toBe(error);
    await expect(localTransactionQueries(connection).execute('UPDATE test SET value = 1')).rejects.toBe(error);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
