import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  saveSupportImages: vi.fn(), removeSupportImages: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({ getPool: () => ({ getConnection: async () => mocks }), execute: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/supportTicketImages', () => ({ saveSupportImages: mocks.saveSupportImages, removeSupportImages: mocks.removeSupportImages }));
import { createSupportTicket, saveSupportTicketUpdate } from '../supportTickets';

const input = { businessId: 'test', submittedByUserId: 1, submittedByName: 'Staff', submittedByEmail: null, sourceApp: 'ims' as const, screenContext: null, subject: 'Error', description: 'Details' };

describe('support ticket persistence', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.execute.mockResolvedValue([{ insertId: 42 }]); });
  it('stores images before committing the ticket', async () => {
    const images = [{ bytes: Buffer.from('image'), extension: '.png' }];
    expect(await createSupportTicket(input, images)).toBe(42);
    expect(mocks.saveSupportImages).toHaveBeenCalledWith(42, images);
    expect(mocks.saveSupportImages.mock.invocationCallOrder[0]).toBeLessThan(mocks.commit.mock.invocationCallOrder[0]);
    expect(mocks.release).toHaveBeenCalled();
  });
  it('rolls back and removes partial images when storage fails', async () => {
    mocks.saveSupportImages.mockRejectedValue(new Error('Disk full'));
    await expect(createSupportTicket(input)).rejects.toThrow('Disk full');
    expect(mocks.rollback).toHaveBeenCalled();
    expect(mocks.removeSupportImages).toHaveBeenCalledWith(42);
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalled();
  });
  it('appends an update atomically with status changes', async () => {
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValueOnce([[{ status: 'open', assigned_to: null }]])
      .mockResolvedValueOnce([[]]).mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ insertId: 42 }]).mockResolvedValueOnce([[{ id: 42, message: 'Status changed to closed.\n\nFixed.' }]]);
    const update = await saveSupportTicketUpdate(8, { status: 'closed', assignedTo: null, message: 'Fixed.', requestId: 'request-1', authorName: 'Admin' });
    expect(update?.id).toBe(42);
    expect(mocks.execute.mock.calls[3][1]).toEqual([8, 'request-1', 'Admin', 'Status changed to closed.\n\nFixed.', 'closed']);
    expect(mocks.commit).toHaveBeenCalled();
  });
  it('replays a request without inserting another update or changing the status', async () => {
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValueOnce([[{ status: 'closed' }]])
      .mockResolvedValueOnce([[{ id: 42, email_status: 'sent' }]]);
    expect((await saveSupportTicketUpdate(8, { status: 'closed', assignedTo: null, message: 'Fixed.', requestId: 'request-1', authorName: 'Admin' }))?.id).toBe(42);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});