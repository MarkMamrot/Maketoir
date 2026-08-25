import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnection,
  mockGetGmailAccess,
  mockImsExecute,
  mockImsQuery,
  mockRecordDraftEditLearning,
  mockReportRuntimeIssue,
  mockSaveGmailReplyDraft,
  mockSendExistingGmailDraft,
} = vi.hoisted(() => ({
  mockConnection: {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    execute: vi.fn(),
    release: vi.fn(),
    rollback: vi.fn(),
  },
  mockGetGmailAccess: vi.fn(),
  mockImsExecute: vi.fn(),
  mockImsQuery: vi.fn(),
  mockRecordDraftEditLearning: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
  mockSaveGmailReplyDraft: vi.fn(),
  mockSendExistingGmailDraft: vi.fn(),
}));

vi.mock('../gmailClient', async importOriginal => {
  const original = await importOriginal<typeof import('../gmailClient')>();
  return {
    ...original,
    getGmailAccess: mockGetGmailAccess,
    saveGmailReplyDraft: mockSaveGmailReplyDraft,
    sendExistingGmailDraft: mockSendExistingGmailDraft,
  };
});
vi.mock('../learning', () => ({ recordDraftEditLearning: mockRecordDraftEditLearning }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));
vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ getConnection: vi.fn().mockResolvedValue(mockConnection) }),
  imsExecute: mockImsExecute,
  imsQuery: mockImsQuery,
}));

import { GmailApiError } from '../gmailClient';
import { sendCustomerServiceReply } from '../replyActions';

const reply = {
  id: 41,
  thread_id: 12,
  version: 2,
  status: 'editing',
  subject: 'Re: Order update',
  ai_generated_body: 'Initial suggestion',
  current_body: 'The reviewed reply',
  operation_key: 'operation-key',
  gmail_draft_id: null,
  gmail_thread_id: 'gmail-thread-12',
  customer_email: 'customer@example.com',
  message_id_header: '<inbound@example.com>',
  references_header: '<first@example.com>',
};

describe('customer-service reply sending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImsQuery.mockResolvedValue([reply]);
    mockImsExecute.mockResolvedValue({ affectedRows: 1 });
    mockGetGmailAccess.mockResolvedValue({ accessToken: 'access', mailboxEmail: 'shop@example.com' });
    mockSaveGmailReplyDraft.mockResolvedValue({ draftId: 'gmail-draft-1', messageId: 'draft-message-1' });
    mockSendExistingGmailDraft.mockResolvedValue({ messageId: 'sent-message-1' });
    mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
    mockRecordDraftEditLearning.mockResolvedValue(undefined);
    mockReportRuntimeIssue.mockResolvedValue(null);
  });

  it('sends one persisted provider draft and inserts the outbound history row', async () => {
    await expect(sendCustomerServiceReply('biz-1', 41, 7)).resolves.toEqual({
      alreadySent: false,
      messageId: 'sent-message-1',
      status: 'sent',
    });

    expect(mockSaveGmailReplyDraft).toHaveBeenCalledOnce();
    expect(mockSendExistingGmailDraft).toHaveBeenCalledWith('access', 'gmail-draft-1');
    expect(mockConnection.beginTransaction).toHaveBeenCalledOnce();
    expect(mockConnection.commit).toHaveBeenCalledOnce();
    expect(mockConnection.execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ims_cs_messages'))).toBe(true);
  });

  it('keeps an ambiguous provider outcome blocked for confirmation', async () => {
    mockSendExistingGmailDraft.mockRejectedValue(new Error('Connection reset'));

    await expect(sendCustomerServiceReply('biz-1', 41, 7)).resolves.toEqual({
      alreadySent: false,
      messageId: undefined,
      status: 'confirming',
    });

    expect(mockImsExecute.mock.calls.some(([sql]) => String(sql).includes("status = 'failed'"))).toBe(false);
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({ operation: 'confirm_reply_delivery' }));
  });

  it('marks a failure before creating the provider draft as safely retryable', async () => {
    mockSaveGmailReplyDraft.mockRejectedValue(new Error('Gmail is not connected'));

    await expect(sendCustomerServiceReply('biz-1', 41, 7)).rejects.toThrow('Gmail is not connected');

    expect(mockSendExistingGmailDraft).not.toHaveBeenCalled();
    expect(mockImsExecute.mock.calls.some(([sql]) => String(sql).includes("status = 'failed'"))).toBe(true);
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({ operation: 'send_reply_rejected' }));
  });

  it('marks an explicit Gmail validation rejection as failed before delivery', async () => {
    mockSendExistingGmailDraft.mockRejectedValue(new GmailApiError('Invalid recipient', 400));

    await expect(sendCustomerServiceReply('biz-1', 41, 7)).rejects.toThrow('Invalid recipient');

    expect(mockImsExecute.mock.calls.some(([sql]) => String(sql).includes("status = 'failed'"))).toBe(true);
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({ operation: 'send_reply_rejected' }));
  });
});