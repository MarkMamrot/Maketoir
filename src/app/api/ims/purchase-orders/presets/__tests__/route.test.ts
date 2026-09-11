import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), imsQuery: vi.fn(), imsExecute: vi.fn(), reportRuntimeIssue: vi.fn() }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { DELETE, GET, POST, PUT } from '../route';

describe('/api/ims/purchase-orders/presets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ businessId: 'business-1', userId: 42, email: 'user@example.com' });
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });
    mocks.reportRuntimeIssue.mockResolvedValue(1);
  });

  it('lists only the signed-in tenant user presets', async () => {
    mocks.imsQuery.mockResolvedValue([{ id: 2, name: 'Open orders', settings_json: '{"status":"confirmed"}', last_used_at: '2026-09-11' }]);
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({ success: true, lastUsedPresetId: '2', presets: [{ id: '2', name: 'Open orders' }] });
    expect(mocks.imsQuery.mock.calls[0][1]).toEqual(['business-1', 'id:42']);
  });

  it('sanitizes and upserts a named preset', async () => {
    mocks.imsQuery.mockResolvedValue([{ id: 3, name: 'August', settings_json: '{"status":"","sortColumn":"order_date"}', last_used_at: '2026-09-11' }]);
    const response = await POST(new Request('http://localhost/presets', { method: 'POST', body: JSON.stringify({ name: 'August', settings: { status: 'invalid', sortColumn: 'DROP' } }) }));
    expect(response.status).toBe(200);
    expect(mocks.imsExecute.mock.calls[0][1].slice(0, 3)).toEqual(['business-1', 'id:42', 'August']);
    expect(mocks.imsExecute.mock.calls[0][1][3]).toContain('"sortColumn":"order_date"');
  });

  it('tenant-scopes selection and deletion', async () => {
    expect((await PUT(new Request('http://localhost/presets', { method: 'PUT', body: JSON.stringify({ presetId: 7 }) }))).status).toBe(200);
    expect(mocks.imsExecute.mock.calls[0][1]).toEqual([7, 'business-1', 'id:42']);
    expect((await DELETE(new Request('http://localhost/presets?id=7', { method: 'DELETE' }))).status).toBe(200);
    expect(mocks.imsExecute.mock.calls[1][1]).toEqual([7, 'business-1', 'id:42']);
  });
});