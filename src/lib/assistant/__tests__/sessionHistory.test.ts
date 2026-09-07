import { describe, expect, it } from 'vitest';

import {
  assistantSessionStorageKey,
  parseAssistantSession,
  serializeAssistantSession,
} from '../sessionHistory';

describe('assistant browser-session history', () => {
  it('round trips bounded role and content only', () => {
    const serialized = serializeAssistantSession([
      { role: 'user', content: '  Where is my order?  ' },
      { role: 'assistant', content: 'I found it.' },
    ], 1_000);

    expect(parseAssistantSession(serialized, 2_000)).toEqual([
      { role: 'user', content: 'Where is my order?' },
      { role: 'assistant', content: 'I found it.' },
    ]);
  });

  it('rejects expired, malformed, and oversized history', () => {
    const serialized = serializeAssistantSession([{ role: 'user', content: 'Hello' }], 1_000);
    expect(parseAssistantSession(serialized, 1_000 + 8 * 60 * 60 * 1_000 + 1)).toEqual([]);
    expect(parseAssistantSession('{bad json', 1_000)).toEqual([]);
    expect(parseAssistantSession('x'.repeat(40_001), 1_000)).toEqual([]);
  });

  it('retains only the latest twenty messages', () => {
    const messages = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `Message ${index}`,
    }));
    const restored = parseAssistantSession(serializeAssistantSession(messages, 1_000), 2_000);

    expect(restored).toHaveLength(20);
    expect(restored[0].content).toBe('Message 5');
  });

  it('isolates histories by authenticated endpoint', () => {
    expect(assistantSessionStorageKey('/api/ims/assistant')).not.toBe(
      assistantSessionStorageKey('/api/pos/assistant'),
    );
  });
});