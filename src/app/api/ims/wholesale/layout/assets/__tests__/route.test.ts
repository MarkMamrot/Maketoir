import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdminTier: vi.fn(),
  listOwned: vi.fn(),
  create: vi.fn(),
  reportRuntimeIssue: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mocks.requireAdminTier }));
vi.mock('@/lib/wholesale/wholesalePortalAsset', () => ({ WholesalePortalAssetRepository: { listOwned: mocks.listOwned, create: mocks.create } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('node:fs/promises', () => ({ default: { mkdir: mocks.mkdir, writeFile: mocks.writeFile, unlink: mocks.unlink } }));

import { GET, POST } from '../route';

const user = { businessId: 'biz-1', userId: 7, name: 'Admin User', tier: 'Admin' };
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function upload(file: File, altText = '') {
  const form = new FormData();
  form.set('file', file);
  form.set('altText', altText);
  return new Request('http://localhost/api/ims/wholesale/layout/assets', { method: 'POST', body: form });
}

describe('IMS wholesale layout asset route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminTier.mockReturnValue({ user });
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.unlink.mockResolvedValue(undefined);
  });

  it('lists assets only for the authenticated business', async () => {
    mocks.listOwned.mockResolvedValue([{ assetId: 'asset-1' }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.listOwned).toHaveBeenCalledWith('biz-1');
  });

  it('rejects a declared image whose bytes do not match', async () => {
    const response = await POST(upload(new File([Uint8Array.from([1, 2, 3])], 'fake.png', { type: 'image/png' })));
    expect(response.status).toBe(400);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('writes a generated file and registers only server-derived metadata', async () => {
    mocks.create.mockImplementation(async input => ({ assetId: input.assetId, url: `/api/wholesale/layout-assets/${input.assetId}` }));
    const response = await POST(upload(new File([png], '../../hero.png', { type: 'image/png' }), 'Hero image'));
    expect(response.status).toBe(201);
    expect(mocks.writeFile).toHaveBeenCalledWith(expect.stringMatching(/biz-1[\\/]wholesale-layout-assets[\\/][0-9a-f-]{36}\.png$/), expect.any(Uint8Array), { flag: 'wx' });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', mimeType: 'image/png', byteSize: 8, originalName: 'hero.png', altText: 'Hero image', actor: { userId: 7, name: 'Admin User' } }));
  });

  it('removes the file when database registration fails', async () => {
    mocks.create.mockRejectedValue(new Error('database unavailable'));
    const response = await POST(upload(new File([png], 'hero.png', { type: 'image/png' })));
    expect(response.status).toBe(500);
    expect(mocks.unlink).toHaveBeenCalledOnce();
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', operation: 'upload' }));
  });
});
