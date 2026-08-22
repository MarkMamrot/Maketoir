import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicActive: vi.fn(),
  readFile: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/wholesale/wholesalePortalAsset', () => ({ WholesalePortalAssetRepository: { getPublicActive: mocks.getPublicActive } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('node:fs/promises', () => ({ default: { readFile: mocks.readFile } }));

import { GET } from '../route';

const assetId = '123e4567-e89b-12d3-a456-426614174000';
const request = new Request(`http://localhost/api/wholesale/layout-assets/${assetId}`);

describe('public wholesale layout asset route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('serves an active supplier-owned opaque asset with immutable headers', async () => {
    mocks.getPublicActive.mockResolvedValue({ assetId, businessId: 'biz-1', storedFilename: `${assetId}.png`, mimeType: 'image/png' });
    mocks.readFile.mockResolvedValue(Uint8Array.from([1, 2, 3]));
    const response = await GET(request, { params: { assetId } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('does not touch the filesystem for inactive or unknown assets', async () => {
    mocks.getPublicActive.mockResolvedValue(null);
    const response = await GET(request, { params: { assetId } });
    expect(response.status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it('rejects non-opaque IDs before querying', async () => {
    const response = await GET(request, { params: { assetId: '../hero.png' } });
    expect(response.status).toBe(404);
    expect(mocks.getPublicActive).not.toHaveBeenCalled();
  });
});
