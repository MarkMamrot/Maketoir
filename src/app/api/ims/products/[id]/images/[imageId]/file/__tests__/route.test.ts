import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), run: vi.fn(), get: vi.fn(), query: vi.fn(), exists: vi.fn(), read: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsImagesRepo: { get: mocks.get } }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('fs', () => ({ default: { existsSync: mocks.exists, readFileSync: mocks.read } }));
import { GET } from '../route';

const params = { id: 'product-1', imageId: '17' };
describe('product image file tenant routing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.run.mockImplementation((_businessId, callback) => callback());
    mocks.get.mockResolvedValue({ source: 'volume', product_id: 'product-1', drive_file_id: 'photo.jpeg' });
    mocks.query.mockResolvedValue([{ business_id: 'biz-1' }]);
    mocks.exists.mockReturnValue(true);
    mocks.read.mockReturnValue(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });
  it('serves JPEG bytes inside the authenticated tenant context', async () => {
    const response = await GET(new Request('http://localhost/image?businessId=other'), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(mocks.run).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(mocks.session).toHaveBeenCalledWith(['marketoir_session', 'pos_session']);
    expect(mocks.read).toHaveBeenCalledWith(expect.stringMatching(/biz-1[\\/]product-images[\\/]photo.jpeg$/));
  });
  it('supports public explicitly tenant-scoped image URLs', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(new Request('http://localhost/image?businessId=biz-1'), { params })).status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith('biz-1', expect.any(Function));
  });
  it('does not query a default schema for an unscoped anonymous request', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(new Request('http://localhost/image'), { params })).status).toBe(404);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('rejects a mismatched product owner', async () => {
    mocks.query.mockResolvedValue([{ business_id: 'other' }]);
    expect((await GET(new Request('http://localhost/image'), { params })).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});