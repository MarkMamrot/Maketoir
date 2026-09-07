const SESSION_VERSION = 1;
const SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const MAX_MESSAGES = 20;
const MAX_CONTENT_LENGTH = 2_000;
const MAX_SERIALIZED_LENGTH = 40_000;

export interface PersistedAssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AssistantSessionHistory {
  version: number;
  expiresAt: number;
  messages: PersistedAssistantMessage[];
}

export function assistantSessionStorageKey(chatEndpoint: string): string {
  return `solvantis-assistant:v1:${chatEndpoint.slice(0, 200)}`;
}

export function serializeAssistantSession(
  messages: PersistedAssistantMessage[],
  now = Date.now(),
): string | null {
  const bounded = messages.slice(-MAX_MESSAGES).flatMap(message => {
    if (message.role !== 'user' && message.role !== 'assistant') return [];
    const content = String(message.content ?? '').trim().slice(0, MAX_CONTENT_LENGTH);
    return content ? [{ role: message.role, content }] : [];
  });
  if (bounded.length === 0) return null;
  const value: AssistantSessionHistory = {
    version: SESSION_VERSION,
    expiresAt: now + SESSION_TTL_MS,
    messages: bounded,
  };
  const serialized = JSON.stringify(value);
  return serialized.length <= MAX_SERIALIZED_LENGTH ? serialized : null;
}

export function parseAssistantSession(value: string | null, now = Date.now()): PersistedAssistantMessage[] {
  if (!value || value.length > MAX_SERIALIZED_LENGTH) return [];
  try {
    const parsed = JSON.parse(value) as Partial<AssistantSessionHistory>;
    if (parsed.version !== SESSION_VERSION || Number(parsed.expiresAt) <= now || !Array.isArray(parsed.messages)) return [];
    return parsed.messages.slice(-MAX_MESSAGES).flatMap(message => {
      if (!message || (message.role !== 'user' && message.role !== 'assistant')) return [];
      const content = String(message.content ?? '').trim().slice(0, MAX_CONTENT_LENGTH);
      return content ? [{ role: message.role, content }] : [];
    });
  } catch {
    return [];
  }
}
