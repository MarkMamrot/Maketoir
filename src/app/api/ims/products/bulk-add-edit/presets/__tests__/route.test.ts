import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), imsQuery: vi.fn(), imsExecute: vi.fn(), reportRuntimeIssue: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { DELETE, GET, POST, PUT } from '../route';

describe('/api/ims/products/bulk-add-edit/presets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ businessId: 'business-1', userId: 42, email: 'user@example.com' });
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });
    mocks.reportRuntimeIssue.mockResolvedValue(1);
  });

  it('lists only the signed-in tenant user presets and identifies the last used preset', async () => {
    mocks.imsQuery.mockResolvedValue([
      { id: 1, name: 'A', settings_json: '{"sortKey":"name"}', last_used_at: '2026-01-01' },
      { id: 2, name: 'B', settings_json: '{"sortKey":"cost"}', last_used_at: '2026-02-01' },
    ]);
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({ success: true, lastUsedPresetId: '2', presets: [{ id: '1' }, { id: '2' }] });
    expect(mocks.imsQuery.mock.calls[0][1]).toEqual(['business-1', 'id:42']);
  });

  it('sanitizes and upserts a named preset for the signed-in tenant user', async () => {
    mocks.imsQuery.mockResolvedValue([{ id: 3, name: 'Low stock', settings_json: '{"sortKey":"cost","filters":[]}', last_used_at: '2026-02-01' }]);
    const response = await POST(new Request('http://localhost/api/ims/products/bulk-add-edit/presets', { method: 'POST', body: JSON.stringify({ name: 'Low stock', settings: { sortKey: 'cost', sortDirection: 'DROP', filters: [] } }) }));
    expect(response.status).toBe(200);
    expect(mocks.imsExecute.mock.calls[0][1].slice(0, 3)).toEqual(['business-1', 'id:42', 'Low stock']);
    expect(mocks.imsExecute.mock.calls[0][1][3]).toContain('"sortDirection":"asc"');
  });

  it('tenant-scopes selection and deletion', async () => {
    expect((await PUT(new Request('http://localhost/presets', { method: 'PUT', body: JSON.stringify({ presetId: 7 }) }))).status).toBe(200);
    expect(mocks.imsExecute.mock.calls[0][1]).toEqual([7, 'business-1', 'id:42']);
    expect((await DELETE(new Request('http://localhost/presets?id=7', { method: 'DELETE' }))).status).toBe(200);
    expect(mocks.imsExecute.mock.calls[1][1]).toEqual([7, 'business-1', 'id:42']);
  });
});