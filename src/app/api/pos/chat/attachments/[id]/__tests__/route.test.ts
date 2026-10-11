import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ identity: vi.fn(), run: vi.fn(), query: vi.fn(), read: vi.fn(), report: vi.fn() }));
vi.mock('../../../_identity', () => ({ resolveChatIdentity: mocks.identity }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('fs/promises', () => ({ default: { readFile: mocks.read } }));
import { GET } from '../route';

describe('chat attachment download', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.identity.mockResolvedValue({ businessId: 'biz-1', locationId: 1 });
    mocks.run.mockImplementation((_businessId, callback) => callback());
    mocks.query.mockResolvedValue([{ original_name: 'photo.png', stored_name: 'stored.png', mime_type: 'image/png', location_id: 1, to_location_id: null, message_id: 300 }]);
    mocks.read.mockResolvedValue(Buffer.from('image'));
  });
  it('loads the file from its tenant and message directory', async () => {
    const response = await GET(new Request('http://localhost/attachment'), { params: { id: '4' } });
    expect(response.status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(mocks.read).toHaveBeenCalledWith(expect.stringMatching(/biz-1[\\/]POSChat[\\/]300[\\/]stored.png$/));
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it('reports a missing stored file and preserves the 404', async () => {
    mocks.read.mockRejectedValue(Object.assign(new Error('Missing'), { code: 'ENOENT' }));
    expect((await GET(new Request('http://localhost/attachment'), { params: { id: '4' } })).status).toBe(404);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', operation: 'missing-attachment-file', context: { attachmentId: 4 } }));
  });
  it('rejects a direct message belonging to other locations', async () => {
    mocks.query.mockResolvedValue([{ location_id: 2, to_location_id: 3 }]);
    expect((await GET(new Request('http://localhost/attachment'), { params: { id: '4' } })).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});