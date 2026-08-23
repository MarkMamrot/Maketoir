import { createHash, randomUUID } from 'crypto';
import type { ResultSetHeader } from 'mysql2/promise';
import { getPool, query as mainQuery } from '@/services/MySQLService';
import { sanitizeProspectAttribution, validateProspectLead } from './policy';
import type { ProspectChatMessage, ProspectLeadInput, PublicIntegrationOffering } from './types';

interface RepositoryConnection {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
  execute<T = unknown>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

export interface SalesAssistantRepositoryDependencies {
  getConnection(): Promise<RepositoryConnection>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  newId(): string;
  now(): Date;
}

const defaultDependencies: SalesAssistantRepositoryDependencies = {
  getConnection: async () => getPool().getConnection() as RepositoryConnection,
  query: mainQuery,
  newId: randomUUID,
  now: () => new Date(),
};

type AttributionInput = Parameters<typeof sanitizeProspectAttribution>[0];

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requiredText(value: string, name: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  if (normalized.length > maxLength) throw new Error(`${name} must be ${maxLength} characters or fewer.`);
  return normalized;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function inTransaction<T>(dependencies: SalesAssistantRepositoryDependencies, work: (connection: RepositoryConnection) => Promise<T>): Promise<T> {
  const connection = await dependencies.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function assertOwned(result: ResultSetHeader): void {
  if (result.affectedRows !== 1) throw new Error('Conversation was not found for this session.');
}

export function createSalesAssistantRepository(overrides: Partial<SalesAssistantRepositoryDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };

  return {
    async prepareUserPrompt(input: {
      conversationId?: string | null;
      sessionId: string;
      prompt: string;
      attribution?: AttributionInput;
    }): Promise<{ conversationId: string; userMessageId: string }> {
      const prompt = requiredText(input.prompt, 'Prompt', 4000);
      const sessionIdHash = hash(requiredText(input.sessionId, 'Session ID', 500));
      const attribution = sanitizeProspectAttribution(input.attribution);
      const conversationId = input.conversationId || dependencies.newId();
      const userMessageId = dependencies.newId();

      return inTransaction(dependencies, async connection => {
        if (input.conversationId) {
          const [result] = await connection.execute<ResultSetHeader>(
            `UPDATE prospect_conversations
                SET last_user_prompt = ?, message_count = message_count + 1,
                    last_message_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
                  WHERE id = ? AND session_id_hash = ? AND status IN ('active','converted')`,
            [prompt, conversationId, sessionIdHash],
          );
          assertOwned(result);
        } else {
          await connection.execute(
            `INSERT INTO prospect_conversations
              (id, session_id_hash, source_path, attribution_json, last_user_prompt, message_count, last_message_at)
             VALUES (?, ?, ?, ?, ?, 1, UTC_TIMESTAMP(3))`,
            [conversationId, sessionIdHash, attribution.sourcePath, json(attribution), prompt],
          );
        }

        await connection.execute(
          `INSERT INTO prospect_messages (id, conversation_id, role, content)
           VALUES (?, ?, 'user', ?)`,
          [userMessageId, conversationId, prompt],
        );
        return { conversationId, userMessageId };
      });
    },

    async appendAssistantMessage(input: {
      conversationId: string;
      sessionId: string;
      content: string;
      modelName?: string | null;
      promptVersion?: string | null;
      metadata?: unknown;
    }): Promise<{ messageId: string; messageCount: number }> {
      const content = requiredText(input.content, 'Assistant message', 20_000);
      const sessionIdHash = hash(requiredText(input.sessionId, 'Session ID', 500));
      const messageId = dependencies.newId();

      return inTransaction(dependencies, async connection => {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE prospect_conversations
              SET message_count = message_count + 1, last_message_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
            WHERE id = ? AND session_id_hash = ? AND status IN ('active','converted')`,
          [input.conversationId, sessionIdHash],
        );
        assertOwned(result);
        await connection.execute(
          `INSERT INTO prospect_messages
            (id, conversation_id, role, content, model_name, prompt_version, metadata_json)
           VALUES (?, ?, 'assistant', ?, ?, ?, ?)`,
          [messageId, input.conversationId, content, input.modelName ?? null, input.promptVersion ?? null, json(input.metadata)],
        );
        const [rows] = await connection.execute<Array<{ message_count: number }>>(
          'SELECT message_count FROM prospect_conversations WHERE id = ? AND session_id_hash = ? LIMIT 1',
          [input.conversationId, sessionIdHash],
        );
        return { messageId, messageCount: Number(rows[0]?.message_count ?? 0) };
      });
    },

    async getOwnedConversation(input: { conversationId: string; sessionId: string }): Promise<{
      conversationId: string;
      status: string;
      messages: Array<ProspectChatMessage & { id: string; createdAt: string | Date }>;
    } | null> {
      const conversationId = requiredText(input.conversationId, 'Conversation ID', 36);
      const sessionIdHash = hash(requiredText(input.sessionId, 'Session ID', 500));
      const conversations = await dependencies.query<ArrayRecord>(
        `SELECT id, status FROM prospect_conversations
          WHERE id = ? AND session_id_hash = ? AND status <> 'blocked' LIMIT 1`,
        [conversationId, sessionIdHash],
      );
      if (conversations.length !== 1) return null;
      const messages = await dependencies.query<ArrayRecord>(
        `SELECT id, role, content, created_at FROM prospect_messages
          WHERE conversation_id = ? ORDER BY created_at, id LIMIT 100`,
        [conversationId],
      );
      return {
        conversationId,
        status: String(conversations[0].status),
        messages: messages.map(message => ({
          id: String(message.id),
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: String(message.content).slice(0, 20_000),
          createdAt: message.created_at as string | Date,
        })),
      };
    },

    async deleteOwnedConversation(input: { conversationId: string; sessionId: string }): Promise<boolean> {
      const conversationId = requiredText(input.conversationId, 'Conversation ID', 36);
      const sessionIdHash = hash(requiredText(input.sessionId, 'Session ID', 500));
      return inTransaction(dependencies, async connection => {
        const [owned] = await connection.execute<Array<{ id: string }>>(
          'SELECT id FROM prospect_conversations WHERE id = ? AND session_id_hash = ? LIMIT 1 FOR UPDATE',
          [conversationId, sessionIdHash],
        );
        if (owned.length !== 1) return false;
        await connection.execute(
          `UPDATE prospect_conversations
              SET status = 'blocked', last_user_prompt = NULL, attribution_json = NULL, updated_at = UTC_TIMESTAMP(3)
            WHERE id = ? AND session_id_hash = ?`,
          [conversationId, sessionIdHash],
        );
        await connection.execute('DELETE FROM prospect_messages WHERE conversation_id = ?', [conversationId]);
        return true;
      });
    },

    async createConsentedLead(input: {
      idempotencyKey: string;
      sessionId: string;
      lead: ProspectLeadInput;
    }): Promise<{ leadId: number }> {
      const idempotencyKey = requiredText(input.idempotencyKey, 'Idempotency key', 191);
      const sessionIdHash = hash(requiredText(input.sessionId, 'Session ID', 500));
      const lead = validateProspectLead(input.lead);

      return inTransaction(dependencies, async connection => {
        if (lead.conversationId) {
          const [rows] = await connection.execute<Array<{ id: string }>>(
            `SELECT id FROM prospect_conversations
              WHERE id = ? AND session_id_hash = ? AND status IN ('active','converted') FOR UPDATE`,
            [lead.conversationId, sessionIdHash],
          );
          if (rows.length !== 1) throw new Error('Conversation was not found for this session.');
        }

        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO prospect_leads
            (idempotency_key, conversation_id, name, company, email, phone, preferred_contact,
             consent_email, consent_phone, consent_sms, consented_at, locations, current_systems, timeframe, source_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
          [idempotencyKey, lead.conversationId ?? null, lead.name, lead.company, lead.email, lead.phone,
            lead.preferredContact, lead.consentEmail, lead.consentPhone, lead.consentSms,
            lead.locations ?? null, lead.currentSystems ?? null, lead.timeframe ?? null, lead.sourcePath],
        );
        const leadId = Number(result.insertId);
        await connection.execute(
          `INSERT INTO prospect_lead_events (idempotency_key, lead_id, event_type, event_data_json)
           VALUES (?, ?, 'created_with_consent', ?)
           ON DUPLICATE KEY UPDATE id = id`,
          [`${idempotencyKey}:created`, leadId, json({ preferredContact: lead.preferredContact })],
        );
        await connection.execute(
          `INSERT INTO prospect_lead_events (idempotency_key, lead_id, event_type, event_data_json)
           VALUES (?, ?, 'alert_pending', ?)
           ON DUPLICATE KEY UPDATE id = id`,
          [`lead-alert-pending:${leadId}`, leadId, json({})],
        );
        if (lead.conversationId) {
          await connection.execute(
            `UPDATE prospect_conversations SET status = 'converted', updated_at = UTC_TIMESTAMP(3)
              WHERE id = ? AND session_id_hash = ?`,
            [lead.conversationId, sessionIdHash],
          );
        }
        return { leadId };
      });
    },

    async recordEvent(input: {
      idempotencyKey: string;
      eventType: string;
      conversationId?: string | null;
      sessionId?: string | null;
      data?: unknown;
    }): Promise<{ eventId: number }> {
      const idempotencyKey = requiredText(input.idempotencyKey, 'Idempotency key', 191);
      const eventType = requiredText(input.eventType, 'Event type', 64);
      return inTransaction(dependencies, async connection => {
        if (input.conversationId) {
          const sessionIdHash = hash(requiredText(input.sessionId ?? '', 'Session ID', 500));
          const [rows] = await connection.execute<Array<{ id: string }>>(
            'SELECT id FROM prospect_conversations WHERE id = ? AND session_id_hash = ? LIMIT 1',
            [input.conversationId, sessionIdHash],
          );
          if (rows.length !== 1) throw new Error('Conversation was not found for this session.');
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO prospect_events (idempotency_key, conversation_id, event_type, event_data_json)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
          [idempotencyKey, input.conversationId ?? null, eventType, json(input.data)],
        );
        return { eventId: Number(result.insertId) };
      });
    },

    async recordIntegrationEvent(input: {
      idempotencyKey: string;
      eventType: string;
      offeringId?: number | null;
      providerName?: string | null;
      conversationId?: string | null;
      sessionId?: string | null;
      data?: unknown;
    }): Promise<{ eventId: number }> {
      const idempotencyKey = requiredText(input.idempotencyKey, 'Idempotency key', 191);
      const eventType = requiredText(input.eventType, 'Event type', 64);
      return inTransaction(dependencies, async connection => {
        if (input.conversationId) {
          const sessionIdHash = hash(requiredText(input.sessionId ?? '', 'Session ID', 500));
          const [rows] = await connection.execute<Array<{ id: string }>>(
            'SELECT id FROM prospect_conversations WHERE id = ? AND session_id_hash = ? LIMIT 1',
            [input.conversationId, sessionIdHash],
          );
          if (rows.length !== 1) throw new Error('Conversation was not found for this session.');
        }
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO sales_integration_events
            (idempotency_key, offering_id, conversation_id, event_type, provider_name, event_data_json)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
          [idempotencyKey, input.offeringId ?? null, input.conversationId ?? null, eventType,
            input.providerName?.trim().slice(0, 191) || null, json(input.data)],
        );
        return { eventId: Number(result.insertId) };
      });
    },

    async consumeRateLimit(input: {
      rateKey: string;
      operation: string;
      limit: number;
      windowSeconds: number;
    }): Promise<{ allowed: boolean; count: number; retryAfterSeconds: number }> {
      if (!Number.isInteger(input.limit) || input.limit < 1) throw new Error('Rate limit must be a positive integer.');
      if (!Number.isInteger(input.windowSeconds) || input.windowSeconds < 1) throw new Error('Rate-limit window must be positive.');
      const now = dependencies.now();
      const windowMilliseconds = input.windowSeconds * 1000;
      const windowStartedAt = new Date(Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds);
      const expiresAt = new Date(windowStartedAt.getTime() + windowMilliseconds);

      return inTransaction(dependencies, async connection => {
        await connection.execute(
          `INSERT INTO prospect_rate_limits (rate_key_hash, operation, window_started_at, request_count, expires_at)
           VALUES (?, ?, ?, 1, ?)
           ON DUPLICATE KEY UPDATE request_count = request_count + 1, expires_at = VALUES(expires_at)`,
          [hash(requiredText(input.rateKey, 'Rate key', 1000)), requiredText(input.operation, 'Operation', 64), windowStartedAt, expiresAt],
        );
        const [rows] = await connection.execute<Array<{ request_count: number }>>(
          `SELECT request_count FROM prospect_rate_limits
            WHERE rate_key_hash = ? AND operation = ? AND window_started_at = ? FOR UPDATE`,
          [hash(input.rateKey.trim()), input.operation.trim(), windowStartedAt],
        );
        const count = Number(rows[0]?.request_count ?? 1);
        return {
          allowed: count <= input.limit,
          count,
          retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)),
        };
      });
    },

    async listPublicEnabledIntegrations(): Promise<PublicIntegrationOffering[]> {
      const rows = await dependencies.query<ArrayRecord>(
        `SELECT id, slug, name, category, delivery_mode, public_summary,
                example_providers_json, supported_workflows_json, qualification_questions_json
           FROM sales_integration_offerings
          WHERE is_enabled = 1 AND delivery_mode <> 'not_offered'
          ORDER BY category, name`,
      );
      return rows.map(row => ({
        id: Number(row.id),
        slug: String(row.slug),
        name: String(row.name),
        category: String(row.category),
        deliveryMode: row.delivery_mode as PublicIntegrationOffering['deliveryMode'],
        publicSummary: String(row.public_summary),
        exampleProviders: parseStringArray(row.example_providers_json),
        supportedWorkflows: parseStringArray(row.supported_workflows_json),
        qualificationQuestions: parseStringArray(row.qualification_questions_json),
      }));
    },
  };
}

type ArrayRecord = Record<string, unknown>;

export const salesAssistantRepository = createSalesAssistantRepository();