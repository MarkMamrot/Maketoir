import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetGmailAccess, mockImsExecute, mockImsQuery, mockModifyLabels, mockModifyThreadLabels } = vi.hoisted(() => ({
  mockGetGmailAccess: vi.fn(),
  mockImsExecute: vi.fn(),
  mockImsQuery: vi.fn(),
  mockModifyLabels: vi.fn(),
  mockModifyThreadLabels: vi.fn(),
}));

vi.mock('../gmailClient', () => ({
  getGmailAccess: mockGetGmailAccess,
  modifyGmailMessageLabels: mockModifyLabels,
  modifyGmailThreadLabels: mockModifyThreadLabels,
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mockImsExecute, imsQuery: mockImsQuery }));

import { updateCustomerServiceMailboxState } from '../mailboxActions';

describe('customer-service mailbox actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImsQuery
      .mockResolvedValueOnce([{ gmail_message_id: 'gmail-message-1' }])
      .mockResolvedValueOnce([{ gmail_thread_id: 'gmail-thread-1' }]);
    mockGetGmailAccess.mockResolvedValue({ accessToken: 'access' });
    mockModifyLabels.mockResolvedValue(undefined);
    mockModifyThreadLabels.mockResolvedValue(undefined);
    mockImsExecute.mockResolvedValue({ affectedRows: 1 });
  });

  it('reports the tenant thread as spam and removes it from the local Inbox', async () => {
    await updateCustomerServiceMailboxState({ businessId: 'biz-1', threadId: 12, action: 'spam' });

    expect(mockImsQuery).toHaveBeenCalledWith(expect.stringContaining('business_id = ? AND thread_id = ?'), ['biz-1', 12]);
    expect(mockModifyThreadLabels).toHaveBeenCalledWith('access', 'gmail-thread-1', {
      addLabelIds: ['SPAM'],
      removeLabelIds: ['INBOX', 'UNREAD'],
    });
    expect(mockModifyLabels).not.toHaveBeenCalled();
    expect(mockImsExecute.mock.calls.some(([sql, params]) =>
      String(sql).includes("category = 'junk'") && String(sql).includes("workflow_status = 'archived'")
      && params[0] === 'biz-1' && params[1] === 12)).toBe(true);
  });
});