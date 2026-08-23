import { describe, expect, it, vi } from 'vitest';
import { createSalesAssistantRepository, type SalesAssistantRepositoryDependencies } from '../repository';

function fakeRepository(respond: (sql: string) => unknown = () => ({ affectedRows: 1, insertId: 1 })) {
  const calls: string[] = [];
  const connection = {
    beginTransaction: vi.fn(async () => { calls.push('begin'); }),
    commit: vi.fn(async () => { calls.push('commit'); }),
    rollback: vi.fn(async () => { calls.push('rollback'); }),
    release: vi.fn(() => { calls.push('release'); }),
    execute: vi.fn(async (sql: string) => {
      calls.push(sql.replace(/\s+/g, ' ').trim());
      return [respond(sql), []];
    }),
  };
  const dependencies: SalesAssistantRepositoryDependencies = {
    getConnection: async () => connection,
    query: vi.fn(async () => []),
    newId: vi.fn().mockReturnValueOnce('conversation-id').mockReturnValueOnce('message-id'),
    now: () => new Date('2026-08-23T12:00:30.000Z'),
  };
  return { repository: createSalesAssistantRepository(dependencies), dependencies, connection, calls };
}

describe('sales assistant repository', () => {
  it('commits the raw user prompt and last_user_prompt together before returning', async () => {
    const { repository, calls } = fakeRepository();
    await expect(repository.prepareUserPrompt({ sessionId: 'browser-session', prompt: '  Do you support Acme ERP?  ' }))
      .resolves.toEqual({ conversationId: 'conversation-id', userMessageId: 'message-id' });

    expect(calls[0]).toBe('begin');
    expect(calls[1]).toContain('INSERT INTO prospect_conversations');
    expect(calls[1]).toContain('last_user_prompt');
    expect(calls[2]).toContain("VALUES (?, ?, 'user', ?)");
    expect(calls[3]).toBe('commit');
  });

  it('enforces session ownership when appending an assistant message', async () => {
    const { repository, connection } = fakeRepository(sql => sql.includes('SELECT message_count')
      ? [{ message_count: 2 }]
      : { affectedRows: 1, insertId: 1 });
    await expect(repository.appendAssistantMessage({ conversationId: 'conversation-id', sessionId: 'owner', content: 'Answer' }))
      .resolves.toMatchObject({ messageCount: 2 });
    const ownershipSql = connection.execute.mock.calls[0][0];
    expect(ownershipSql).toContain('WHERE id = ? AND session_id_hash = ?');
    expect(connection.execute.mock.calls[1][0]).toContain("'assistant'");
  });

  it('restores and deletes only a session-owned conversation', async () => {
    const { repository, dependencies, connection } = fakeRepository(sql => sql.includes('SELECT id FROM prospect_conversations')
      ? [{ id: 'conversation-id' }]
      : { affectedRows: 1, insertId: 1 });
    vi.mocked(dependencies.query)
      .mockResolvedValueOnce([{ id: 'conversation-id', status: 'active' }])
      .mockResolvedValueOnce([{ id: 'message-id', role: 'user', content: 'Hello', created_at: '2026-08-23' }]);
    await expect(repository.getOwnedConversation({ conversationId: 'conversation-id', sessionId: 'owner' }))
      .resolves.toMatchObject({ messages: [{ role: 'user', content: 'Hello' }] });
    await expect(repository.deleteOwnedConversation({ conversationId: 'conversation-id', sessionId: 'owner' })).resolves.toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes("status = 'blocked'"))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('DELETE FROM prospect_messages'))).toBe(true);
  });

  it('restores the latest non-deleted conversation for a browser session', async () => {
    const { repository, dependencies } = fakeRepository();
    vi.mocked(dependencies.query)
      .mockResolvedValueOnce([{ id: 'latest-conversation' }])
      .mockResolvedValueOnce([{ id: 'latest-conversation', status: 'active' }])
      .mockResolvedValueOnce([{ id: 'message-id', role: 'assistant', content: 'Welcome back', created_at: '2026-08-23' }]);

    await expect(repository.getLatestOwnedConversation({ sessionId: 'owner' }))
      .resolves.toMatchObject({ conversationId: 'latest-conversation', messages: [{ content: 'Welcome back' }] });
    expect(vi.mocked(dependencies.query).mock.calls[0][0]).toContain("status <> 'blocked'");
  });

  it('rolls back when a conversation is not owned by the session', async () => {
    const { repository, calls } = fakeRepository(sql => sql.includes('UPDATE prospect_conversations')
      ? { affectedRows: 0, insertId: 0 }
      : { affectedRows: 1, insertId: 1 });
    await expect(repository.appendAssistantMessage({ conversationId: 'other', sessionId: 'owner', content: 'Answer' }))
      .rejects.toThrow('not found for this session');
    expect(calls).toContain('rollback');
    expect(calls).not.toContain('commit');
  });

  it('creates consented leads and events idempotently', async () => {
    const { repository, connection } = fakeRepository(sql => {
      if (sql.includes('SELECT id FROM prospect_conversations')) return [{ id: 'conversation-id' }];
      return { affectedRows: 1, insertId: 42 };
    });
    await expect(repository.createConsentedLead({
      idempotencyKey: 'lead-request-1',
      sessionId: 'owner',
      lead: {
        conversationId: 'conversation-id', name: 'Ada', email: 'ada@example.com', preferredContact: 'email',
        consentEmail: true, consentPhone: false, consentSms: false,
      },
    })).resolves.toEqual({ leadId: 42 });
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)'))).toBe(true);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes('prospect_lead_events'))).toBe(true);
  });

  it('records integration interest idempotently after checking conversation ownership', async () => {
    const { repository, connection } = fakeRepository(sql => sql.includes('SELECT id FROM prospect_conversations')
      ? [{ id: 'conversation-id' }]
      : { affectedRows: 1, insertId: 17 });
    await expect(repository.recordIntegrationEvent({
      idempotencyKey: 'integration-event-1', eventType: 'interest_recorded', offeringId: 3,
      conversationId: 'conversation-id', sessionId: 'owner', providerName: 'Acme ERP',
    })).resolves.toEqual({ eventId: 17 });
    expect(connection.execute.mock.calls[0][0]).toContain('session_id_hash = ?');
    expect(connection.execute.mock.calls[1][0]).toContain('ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)');
  });

  it('does not query internal notes and filters disabled or not-offered integrations in SQL', async () => {
    const { repository, dependencies } = fakeRepository();
    vi.mocked(dependencies.query).mockResolvedValueOnce([{
      id: 1, slug: 'xero', name: 'Xero', category: 'accounting_erp', delivery_mode: 'native',
      public_summary: 'Public', example_providers_json: '["Xero"]', supported_workflows_json: '[]',
      qualification_questions_json: '[]',
    }]);
    await expect(repository.listPublicEnabledIntegrations()).resolves.toMatchObject([{ slug: 'xero', exampleProviders: ['Xero'] }]);
    const sql = vi.mocked(dependencies.query).mock.calls[0][0];
    expect(sql).toContain("is_enabled = 1 AND delivery_mode <> 'not_offered'");
    expect(sql).not.toContain('internal_notes');
  });

  it('uses a shared database counter for rate limiting', async () => {
    const { repository, connection } = fakeRepository(sql => sql.includes('SELECT request_count')
      ? [{ request_count: 4 }]
      : { affectedRows: 1, insertId: 0 });
    await expect(repository.consumeRateLimit({ rateKey: 'ip:user-agent', operation: 'chat', limit: 3, windowSeconds: 60 }))
      .resolves.toEqual({ allowed: false, count: 4, retryAfterSeconds: 30 });
    expect(connection.execute.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE request_count = request_count + 1');
  });
});