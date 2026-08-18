import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockContactGet, mockImsQuery, mockImsExecute } = vi.hoisted(() => ({
  mockContactGet: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
}));

vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsContactsRepo: { get: mockContactGet },
}));

vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mockImsQuery,
  imsExecute: mockImsExecute,
}));

import {
  ContactCrmNotFoundError,
  ContactCrmValidationError,
  addContactCrmTag,
  createContactCrmInteraction,
  createContactCrmTask,
  getContactCrmWorkspace,
  updateContactCrmTask,
} from '../contactCrmService';

describe('contact CRM service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContactGet.mockResolvedValue({ id: 42, business_id: 'business-1', name: 'Customer' });
    mockImsQuery.mockResolvedValue([]);
    mockImsExecute.mockResolvedValue({ insertId: 7, affectedRows: 1 });
  });

  it('fences the contact by business before writing', async () => {
    mockContactGet.mockResolvedValue(null);

    await expect(createContactCrmInteraction(
      'business-1', 42, { body: 'Called customer' }, { id: 9, name: 'Alex' },
    )).rejects.toBeInstanceOf(ContactCrmNotFoundError);

    expect(mockContactGet).toHaveBeenCalledWith(42, 'business-1');
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('validates interaction types before inserting server-owned actor data', async () => {
    await expect(createContactCrmInteraction(
      'business-1', 42, { interactionType: 'email', body: 'Sent it' }, { id: 9, name: 'Alex' },
    )).rejects.toBeInstanceOf(ContactCrmValidationError);
    expect(mockImsExecute).not.toHaveBeenCalled();

    await createContactCrmInteraction(
      'business-1', 42, { interactionType: 'call', body: ' Discussed order ' }, { id: 9, name: 'Alex' },
    );
    expect(mockImsExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_crm_interactions'),
      ['business-1', 42, 'call', 'Discussed order', null, 9, 'Alex'],
    );
  });

  it('rejects malformed task inputs without writing', async () => {
    await expect(createContactCrmTask(
      'business-1', 42,
      { title: 'Follow up', dueDate: '18/08/2026', priority: 'urgent' },
      { id: 9, name: 'Alex' },
    )).rejects.toBeInstanceOf(ContactCrmValidationError);
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('builds tenant-scoped workspace task and contact metadata without per-contact queries', async () => {
    mockImsQuery
      .mockResolvedValueOnce([{ id: 7, contact_id: 42, title: 'Call customer' }])
      .mockResolvedValueOnce([{ contact_id: 42, open_task_count: 2, overdue_task_count: 1 }])
      .mockResolvedValueOnce([{ contact_id: 42, last_interaction_at: '2026-08-18 09:00:00' }])
      .mockResolvedValueOnce([{ contact_id: 42, id: 3, name: 'VIP', color: null }])
      .mockResolvedValueOnce([{ id: 3, name: 'VIP', color: null, usage_count: 1 }]);

    const workspace = await getContactCrmWorkspace('business-1');

    expect(workspace.tasks).toHaveLength(1);
    expect(workspace.taskTruncated).toBe(false);
    expect(workspace.contactMeta[42]).toEqual({
      openTaskCount: 2,
      overdueTaskCount: 1,
      lastInteractionAt: '2026-08-18 09:00:00',
      tags: [{ id: 3, name: 'VIP', color: null }],
    });
    expect(workspace.tags).toHaveLength(1);
    expect(mockImsQuery).toHaveBeenCalledTimes(5);
    expect(mockImsQuery.mock.calls.every(([, params]) => params[0] === 'business-1')).toBe(true);
  });

  it('records completion using the current actor rather than client actor fields', async () => {
    mockImsQuery.mockResolvedValue([{
      id: 6,
      title: 'Follow up',
      description: null,
      due_date: '2026-08-20',
      priority: 'normal',
      status: 'open',
      assigned_user_id: 2,
      assigned_user_name: 'Sam',
    }]);

    await updateContactCrmTask(
      'business-1', 42, 6,
      { title: 'Follow up', status: 'completed' },
      { id: 9, name: 'Alex' },
    );

    const params = mockImsExecute.mock.calls[0][1];
    expect(params.slice(7, 9)).toEqual([9, 'Alex']);
    expect(params[9]).toBeInstanceOf(Date);
    expect(params.slice(-3)).toEqual([6, 'business-1', 42]);
  });

  it('updates task details and assignee while retaining its open status', async () => {
    mockImsQuery.mockResolvedValue([{
      id: 6, title: 'Old title', description: null, due_date: null, priority: 'normal', status: 'open',
      assigned_user_id: null, assigned_user_name: null,
    }]);

    await updateContactCrmTask(
      'business-1', 42, 6,
      { title: 'Updated title', description: 'Call after lunch', dueDate: '2026-08-25', priority: 'high', assignedUserId: 4, assignedUserName: 'Sam' },
      { id: 9, name: 'Alex' },
    );

    expect(mockImsExecute.mock.calls[0][1]).toEqual([
      'Updated title', 'Call after lunch', '2026-08-25', 'high', 'open', 4, 'Sam',
      null, null, null, 6, 'business-1', 42,
    ]);
  });

  it('preserves completion actor and timestamp on a repeated completion retry', async () => {
    mockImsQuery.mockResolvedValue([{
      id: 6, title: 'Follow up', description: null, due_date: null, priority: 'normal', status: 'completed',
      assigned_user_id: null, assigned_user_name: null,
      completed_by: 3, completed_by_name: 'Sam', completed_at: '2026-08-18 10:00:00',
    }]);

    await updateContactCrmTask(
      'business-1', 42, 6, { title: 'Follow up', status: 'completed' }, { id: 9, name: 'Alex' },
    );

    expect(mockImsExecute.mock.calls[0][1].slice(7, 10)).toEqual([3, 'Sam', '2026-08-18 10:00:00']);
  });

  it('normalizes tags and uses tenant-leading idempotent assignment writes', async () => {
    mockImsExecute
      .mockResolvedValueOnce({ insertId: 12, affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 0, affectedRows: 1 });

    await addContactCrmTag('business-1', 42, '  VIP   Customer ', { id: 9, name: 'Alex' });

    expect(mockImsExecute.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)');
    expect(mockImsExecute.mock.calls[0][1]).toEqual(['business-1', 'VIP Customer', 'vip customer', 9, 'Alex']);
    expect(mockImsExecute.mock.calls[1]).toEqual([
      expect.stringContaining('INSERT IGNORE INTO ims_crm_contact_tags'),
      ['business-1', 42, 12, 9, 'Alex'],
    ]);
  });
});