import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), getTicket: vi.fn(), readFile: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/supportTickets', () => ({ getSupportTicket: mocks.getTicket }));
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>(), readFile: mocks.readFile }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { GET } from '../route';

const params = { id: '42', filename: '12345678-1234-1234-1234-123456789abc.png' };
const request = new Request('http://localhost');

describe('support ticket private images', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockReturnValue({ user: { userId: 1 } });
    mocks.getTicket.mockResolvedValue({ id: 42 });
    mocks.readFile.mockResolvedValue(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });
  it('denies users without Super Admin access before reading files', async () => {
    mocks.auth.mockReturnValue({ response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await GET(request, { params })).status).toBe(403);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
  it('serves authenticated images with private cache and MIME protections', async () => {
    const response = await GET(request, { params });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
  it('rejects traversal', async () => {
    expect((await GET(request, { params: { ...params, filename: '../file.png' } })).status).toBe(400);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
  it('returns 404 for missing files', async () => {
    mocks.readFile.mockRejectedValue(Object.assign(new Error('Missing'), { code: 'ENOENT' }));
    expect((await GET(request, { params })).status).toBe(404);
  });
});