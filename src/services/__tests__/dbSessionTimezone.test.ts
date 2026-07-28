import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Guards against the "DB server clock/timezone skew" class of bug (see
// /memories/repo/db-gotchas.md — "DB server clock runs ~9h BEHIND app
// server"). `timezone: 'Z'` on the mysql2 pool only controls how JS Date
// params/results are serialised on the Node side; it does NOT change what
// the MySQL *session* considers "now" for NOW()/CURRENT_TIMESTAMP() /
// ON UPDATE CURRENT_TIMESTAMP (e.g. `updated_at` columns used by the POS
// incremental "since=" sync). Both pools must explicitly pin the session
// time_zone to UTC on every new physical connection so DB-computed
// timestamps can never silently drift onto a different basis than the
// UTC-based values the app sends/compares.
// ─────────────────────────────────────────────────────────────────────────────

type ConnectionListener = (conn: { query: (sql: string, cb: (err: Error | null) => void) => void }) => void;

function makeFakePool() {
  const listeners: Record<string, ConnectionListener[]> = {};
  return {
    on: vi.fn((event: string, cb: ConnectionListener) => {
      (listeners[event] ??= []).push(cb);
    }),
    execute: vi.fn().mockResolvedValue([[]]),
    getConnection: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    __listeners: listeners,
  };
}

let fakePool: ReturnType<typeof makeFakePool>;
const createPool = vi.fn(() => fakePool);

vi.mock('mysql2/promise', () => ({
  default: { createPool: (...args: any[]) => createPool(...args) },
}));

vi.mock('@/lib/db/BusinessRegistry', () => ({
  getImsDbNameSync: vi.fn(),
  getImsDbNameStrict: vi.fn(),
  primeImsDbMap: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.resetModules();
  fakePool = makeFakePool();
  createPool.mockClear();
  // These modules cache pools on globalThis so they survive Next.js HMR —
  // reset between tests so each test gets a fresh pool via our fake createPool.
  delete (globalThis as any).__imsPools;
  delete (globalThis as any).__imsPoolLastUsed;
  delete (globalThis as any).__imsPoolSweeper;
  delete (globalThis as any).__mysqlPool;
});

describe('IMS pool — session time_zone pinning', () => {
  it('creates the pool with client-side UTC serialisation (timezone: "Z")', async () => {
    const { getIMSPool } = await import('../IMSMySQLService');
    getIMSPool('some_tenant_schema');
    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createPool.mock.calls[0][0]).toMatchObject({ timezone: 'Z', dateStrings: true });
  });

  it('pins every new pooled connection\'s session time_zone to UTC', async () => {
    const { getIMSPool } = await import('../IMSMySQLService');
    getIMSPool('some_tenant_schema');

    expect(fakePool.on).toHaveBeenCalledWith('connection', expect.any(Function));
    const onConnection = fakePool.__listeners['connection'][0];

    const queriedSql: string[] = [];
    const fakeConn = { query: (sql: string, cb: (err: Error | null) => void) => { queriedSql.push(sql); cb(null); } };
    onConnection(fakeConn);

    expect(queriedSql).toEqual(["SET time_zone = '+00:00'"]);
  });
});

describe('Main pool — session time_zone pinning', () => {
  it('pins every new pooled connection\'s session time_zone to UTC', async () => {
    const { getPool } = await import('../MySQLService');
    getPool();

    expect(createPool.mock.calls[0][0]).toMatchObject({ timezone: 'Z' });
    const onConnection = fakePool.__listeners['connection'][0];

    const queriedSql: string[] = [];
    const fakeConn = { query: (sql: string, cb: (err: Error | null) => void) => { queriedSql.push(sql); cb(null); } };
    onConnection(fakeConn);

    expect(queriedSql).toEqual(["SET time_zone = '+00:00'"]);
  });
});
