import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ identity: vi.fn(), query: vi.fn(), execute: vi.fn(), run: vi.fn(), report: vi.fn() }));
vi.mock('../_identity', () => ({ resolveChatIdentity: mocks.identity }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { GET, POST } from '../route';

describe('chat message tenant context', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.identity.mockResolvedValue({ businessId: 'tenant-chat', locationId: 2, locationName: 'Store', userName: 'Staff' });
    let inside = false;
    mocks.run.mockImplementation(async (_businessId, callback) => { inside = true; try { return await callback(); } finally { inside = false; } });
    mocks.query.mockImplementation(async (sql: string) => { expect(inside).toBe(true); return sql.includes('information_schema') ? [{ c: 1 }] : []; });
    mocks.execute.mockImplementation(async () => { expect(inside).toBe(true); return { insertId: 10 }; });
  });
  it('loads messages inside the resolved tenant callback', async () => {
    expect((await GET(new Request('http://localhost/api/pos/chat'))).status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith('tenant-chat', expect.any(Function));
  });
  it('sends inside the resolved tenant callback', async () => {
    const response = await POST(new Request('http://localhost/api/pos/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Test' }) }));
    expect(await response.json()).toMatchObject({ success: true, id: 10 });
    expect(mocks.run).toHaveBeenCalledWith('tenant-chat', expect.any(Function));
  });
});