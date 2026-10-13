import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ identity: vi.fn(), query: vi.fn(), execute: vi.fn(), run: vi.fn(), mkdir: vi.fn(), write: vi.fn(), unlink: vi.fn(), report: vi.fn() }));
vi.mock('../../_identity', () => ({ resolveChatIdentity: mocks.identity }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('fs/promises', () => ({ default: { mkdir: mocks.mkdir, writeFile: mocks.write, unlink: mocks.unlink } }));
import { POST } from '../route';

describe('chat attachment upload tenant scope', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.identity.mockResolvedValue({ businessId: 'tenant-a', locationId: 2 });
    mocks.query.mockImplementation(async (sql: string) => sql.includes('COUNT') ? [{ count: 0 }] : [{ location_id: 2 }]);
    mocks.execute.mockResolvedValue({ insertId: 7 });
    mocks.run.mockImplementation(async (_businessId, callback) => {
      mocks.query.mockImplementation(async (sql: string) => sql.includes('COUNT') ? [{ count: 0 }] : [{ location_id: 2 }]);
      return callback();
    });
  });
  it('executes attachment ownership, storage and insert inside the resolved tenant callback', async () => {
    let inside = false;
    mocks.run.mockImplementation(async (_businessId, callback) => { inside = true; try { return await callback(); } finally { inside = false; } });
    mocks.query.mockImplementation(async (sql: string) => { expect(inside).toBe(true); return sql.includes('COUNT') ? [{ count: 0 }] : [{ location_id: 2 }]; });
    mocks.execute.mockImplementation(async () => { expect(inside).toBe(true); return { insertId: 7 }; });
    const form = new FormData();
    form.set('message_id', '3');
    form.set('file', new File(['image'], 'screenshot.png', { type: 'image/png' }));
    const response = await POST(new Request('http://localhost/api/pos/chat/attachments', { method: 'POST', body: form }));
    expect(response.status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith('tenant-a', expect.any(Function));
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('file_content'), [3, 'screenshot.png', expect.any(String), 'image/png', 5, Buffer.from('image')]);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});