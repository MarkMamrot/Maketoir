import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnection, mockFetchRecentGmailThreads, mockGetGmailAccess } = vi.hoisted(() => ({
  mockConnection: {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    query: vi.fn(),
    release: vi.fn(),
    rollback: vi.fn(),
  },
  mockFetchRecentGmailThreads: vi.fn(),
  mockGetGmailAccess: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ getConnection: vi.fn().mockResolvedValue(mockConnection) }),
}));
vi.mock('../gmailClient', () => ({
  fetchRecentGmailThreads: mockFetchRecentGmailThreads,
  getGmailAccess: mockGetGmailAccess,
}));
vi.mock('../repository', () => ({
  getCustomerServiceSettings: vi.fn().mockResolvedValue({ lookbackDays: 7 }),
}));

import { syncCustomerServiceMailbox } from '../syncMailbox';

describe('customer-service mailbox sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGmailAccess.mockResolvedValue({ accessToken: 'access', mailboxEmail: 'shop@example.com' });
    mockFetchRecentGmailThreads.mockResolvedValue([{
      gmailThreadId: 'gmail-thread-12',
      historyId: 'history-2',
      snippet: 'The reviewed reply',
      messages: [{
        gmailMessageId: 'sent-message-1',
        gmailThreadId: 'gmail-thread-12',
        from: 'shop@example.com',
        to: ['customer@example.com'],
        cc: [],
        subject: 'Re: Order update',
        messageIdHeader: '<cs-operation-key@solvantis.local>',
        referencesHeader: '<inbound@example.com>',
        unsubscribeUrl: null,
        bodyPlain: 'The reviewed reply',
        labels: ['SENT'],
        attachments: [],
        messageAt: '2026-08-25 01:00:00',
      }],
    }]);
    mockConnection.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT latest_message_id FROM ims_cs_threads')) return [[{ latest_message_id: 'inbound-message-1' }], []];
      if (sql.includes('SELECT id FROM ims_contacts')) return [[], []];
      if (sql.includes('SELECT id FROM ims_cs_threads')) return [[{ id: 12 }], []];
      if (sql.includes('SELECT d.id, m.gmail_message_id')) return [[{ id: 41, gmail_message_id: 'sent-message-1' }], []];
      return [{ affectedRows: 1 }, []];
    });
  });

  it('finalizes a pending send when Gmail returns its stable Message-ID', async () => {
    await expect(syncCustomerServiceMailbox('biz-1')).resolves.toEqual({ threads: 1, messages: 1 });

    expect(mockConnection.query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'sent', gmail_sent_message_id = ?"))).toBe(true);
    expect(mockConnection.query.mock.calls.some(([sql]) => String(sql).includes("'reply_send_reconciled'"))).toBe(true);
    expect(mockConnection.commit).toHaveBeenCalledOnce();
  });

  it('persists standard unsubscribe metadata with synced messages', async () => {
    mockFetchRecentGmailThreads.mockResolvedValueOnce([{
      gmailThreadId: 'gmail-thread-12', historyId: 'history-2', snippet: 'Newsletter',
      messages: [{
        gmailMessageId: 'newsletter-1', gmailThreadId: 'gmail-thread-12', from: 'news@example.com',
        to: ['shop@example.com'], cc: [], subject: 'Newsletter', messageIdHeader: '<newsletter@example.com>',
        referencesHeader: '', unsubscribeUrl: 'https://example.com/unsubscribe', bodyPlain: 'News',
        labels: ['INBOX'], attachments: [], messageAt: '2026-08-25 01:00:00',
      }],
    }]);

    await syncCustomerServiceMailbox('biz-1');

    const insertCall = mockConnection.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO ims_cs_messages'));
    expect(insertCall?.[0]).toContain('unsubscribe_url');
    expect(insertCall?.[1]).toContain('https://example.com/unsubscribe');
  });
});