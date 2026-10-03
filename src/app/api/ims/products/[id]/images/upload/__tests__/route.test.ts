import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getImsSession: vi.fn(),
  add: vi.fn(),
  updateUrl: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsImagesRepo: { add: mocks.add, updateUrl: mocks.updateUrl },
}));
vi.mock('fs', () => ({
  default: { mkdirSync: mocks.mkdirSync, writeFileSync: mocks.writeFileSync },
}));

import { POST } from '../route';

function uploadRequest(file: File): Request {
  const form = new FormData();
  form.set('file', file);
  form.set('is_primary', '1');
  return new Request('http://localhost/api/ims/products/product-1/images/upload', {
    method: 'POST',
    body: form,
  });
}

describe('POST /api/ims/products/[id]/images/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImsSession.mockResolvedValue({ businessId: 'biz-1' });
    mocks.add.mockResolvedValue(17);
    mocks.updateUrl.mockResolvedValue(undefined);
  });

  it('stores a JPG as a Volume image and registers its serving URL', async () => {
    const jpgBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const response = await POST(
      uploadRequest(new File([jpgBytes], 'product.jpg', { type: 'image/jpeg' })),
      { params: { id: 'product-1' } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      id: 17,
      url: '/api/ims/products/product-1/images/17/file',
    });
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/biz-1[\\/]product-images[\\/]product-1-\d+\.jpg$/),
      expect.any(Buffer),
    );
    expect(mocks.add).toHaveBeenCalledWith('product-1', '', 'volume', expect.objectContaining({
      driveFileId: expect.stringMatching(/^product-1-\d+\.jpg$/),
      isPrimary: true,
    }));
    expect(mocks.updateUrl).toHaveBeenCalledWith(17, '/api/ims/products/product-1/images/17/file');
  });
});