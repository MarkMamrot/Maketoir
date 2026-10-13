import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ context: vi.fn(), run: vi.fn(), query: vi.fn(), execute: vi.fn(), read: vi.fn(), report: vi.fn(), connection: { beginTransaction: vi.fn(), query: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() } }));
vi.mock('../../route', () => ({ resolveContext: mocks.context }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute, getIMSPool: () => ({ getConnection: async () => mocks.connection }) }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('fs/promises', () => ({ default: { readFile: mocks.read } }));
import { POST, PUT } from '../route';
import { GET } from '../[id]/route';

function form(retainedIds = [4], files = [new File(['image'], 'photo.JPG', { type: 'image/jpeg' })]) {
  const data = new FormData();
  data.set('communication_id', '3');
  data.set('staff_name', 'Staff');
  data.set('staff_initials', 'ST');
  data.set('retained_attachment_ids', JSON.stringify(retainedIds));
  data.set('original_attachment_ids', JSON.stringify([4]));
  files.forEach(file => data.append('files', file));
  return data;
}

describe('Daybook attachment storage and editing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.context.mockResolvedValue({ businessId: 'tenant-a', locationId: 2, isManager: true, actorUserId: 1 });
    mocks.run.mockImplementation((_businessId, callback) => callback());
    mocks.query.mockImplementation(async (sql: string) => sql.includes('COUNT') ? [{ count: 0 }] : sql.includes('ims_settings') ? [{ value: 'managers' }] : [{ id: 3, original_name: 'photo.JPG', stored_name: 'stored.jpg', mime_type: 'image/jpeg', communication_id: 3, file_content: Buffer.from('durable') }]);
    mocks.execute.mockResolvedValue({ insertId: 7 });
    mocks.connection.query.mockImplementation(async (sql: string) => [sql.includes('communication_attachments') ? [{ id: 4 }] : [{ id: 3 }]]);
    mocks.read.mockResolvedValue(Buffer.from('legacy'));
  });

  it('downloads durable bytes without a filesystem dependency', async () => {
    const response = await GET(new Request('http://localhost/attachment'), { params: { id: '4' } });
    expect(await response.text()).toBe('durable');
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledWith('tenant-a', expect.any(Function));
  });

  it('keeps legacy file downloads working', async () => {
    mocks.query.mockResolvedValue([{ original_name: 'photo.JPG', stored_name: 'stored.jpg', mime_type: 'image/jpeg', communication_id: 3, file_content: null }]);
    const response = await GET(new Request('http://localhost/attachment'), { params: { id: '4' } });
    expect(await response.text()).toBe('legacy');
    expect(mocks.read).toHaveBeenCalledWith(expect.stringMatching(/tenant-a[\\/]DaybookCommunications[\\/]3[\\/]stored.jpg$/));
  });

  it('reports missing legacy bytes instead of silently returning 404', async () => {
    mocks.query.mockResolvedValue([{ original_name: 'photo.JPG', stored_name: 'stored.jpg', mime_type: 'image/jpeg', communication_id: 3 }]);
    mocks.read.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    expect((await GET(new Request('http://localhost/attachment'), { params: { id: '4' } })).status).toBe(404);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'tenant-a', operation: 'missing-attachment-file' }));
  });

  it('stores an upload atomically with its bytes in the tenant', async () => {
    const data = form();
    data.set('file', new File(['image'], 'photo.JPG', { type: 'image/jpeg' }));
    const response = await POST(new Request('http://localhost/attachments', { method: 'POST', body: data }));
    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('file_content'), ['tenant-a', 3, 'photo.JPG', expect.any(String), 'image/jpeg', 5, Buffer.from('image')]);
  });

  it('removes and replaces attachments in one tenant transaction', async () => {
    const response = await PUT(new Request('http://localhost/attachments', { method: 'PUT', body: form() }));
    expect(response.status).toBe(200);
    expect(mocks.connection.execute).toHaveBeenCalledWith(expect.stringContaining('AND id NOT IN (?)'), ['tenant-a', 3, 4]);
    expect(mocks.connection.execute).toHaveBeenCalledWith(expect.stringContaining('file_content'), ['tenant-a', 3, 'photo.JPG', expect.any(String), 'image/jpeg', 5, Buffer.from('image')]);
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
    expect(mocks.connection.release).toHaveBeenCalledOnce();
  });

  it('allows removing all attachments', async () => {
    expect((await PUT(new Request('http://localhost/attachments', { method: 'PUT', body: form([], []) }))).status).toBe(200);
    expect(mocks.connection.execute).toHaveBeenCalledWith(expect.stringMatching(/^DELETE .*communication_id = \?$/), ['tenant-a', 3]);
  });

  it('rolls back removal when replacement fails', async () => {
    mocks.connection.execute.mockResolvedValueOnce({ affectedRows: 1 }).mockRejectedValueOnce(new Error('database failure'));
    expect((await PUT(new Request('http://localhost/attachments', { method: 'PUT', body: form() }))).status).toBe(500);
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
    expect(mocks.connection.commit).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'tenant-a', operation: 'replace-attachments' }));
  });

  it('rejects attachment changes by staff outside the edit policy', async () => {
    mocks.context.mockResolvedValue({ businessId: 'tenant-a', locationId: 2, isManager: false, actorUserId: 8 });
    expect((await PUT(new Request('http://localhost/attachments', { method: 'PUT', body: form() }))).status).toBe(403);
    expect(mocks.connection.beginTransaction).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('rejects attachment IDs belonging to a different communication', async () => {
    expect((await PUT(new Request('http://localhost/attachments', { method: 'PUT', body: form([99]) }))).status).toBe(409);
    expect(mocks.connection.execute).not.toHaveBeenCalled();
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
  });
  it('does not remove files added by another editor after the draft opened', async () => {
    mocks.connection.query.mockImplementation(async (sql: string) => [sql.includes('communication_attachments') ? [{ id: 4 }, { id: 5 }] : [{ id: 3 }]]);
    expect((await PUT(new Request('http://localhost/attachments', { method: 'PUT', body: form([], []) }))).status).toBe(409);
    expect(mocks.connection.execute).not.toHaveBeenCalled();
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
  });

  it('rejects more than three files including retained attachments', async () => {
    expect((await PUT(new Request('http://localhost/attachments', { method: 'PUT', body: form([1, 2, 3]) }))).status).toBe(400);
    expect(mocks.connection.beginTransaction).not.toHaveBeenCalled();
  });
});