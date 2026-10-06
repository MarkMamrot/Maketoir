import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  saveSupportImages: vi.fn(), removeSupportImages: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({ getPool: () => ({ getConnection: async () => mocks }), execute: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/supportTicketImages', () => ({ saveSupportImages: mocks.saveSupportImages, removeSupportImages: mocks.removeSupportImages }));
import { createSupportTicket } from '../supportTickets';

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
});