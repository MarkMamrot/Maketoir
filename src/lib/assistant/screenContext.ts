const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 30;
const MAX_STRING_LENGTH = 500;
const MAX_TOTAL_CHARACTERS = 8_000;

const SENSITIVE_KEY = /(?:password|secret|token|cookie|authorization|email|phone|address|customer|contact|card_number)/i;

export type AssistantScreenContext = Record<string, unknown>;

export function sanitizeAssistantScreenContext(value: unknown): AssistantScreenContext | null {
  let remaining = MAX_TOTAL_CHARACTERS;

  const visit = (current: unknown, depth: number): unknown => {
    if (remaining <= 0 || depth > MAX_DEPTH || current == null) return null;
    if (typeof current === 'boolean') return current;
    if (typeof current === 'number') return Number.isFinite(current) ? current : null;
    if (typeof current === 'string') {
      const bounded = current.trim().slice(0, Math.min(MAX_STRING_LENGTH, remaining));
      remaining -= bounded.length;
      return bounded;
    }
    if (Array.isArray(current)) {
      return current.slice(0, MAX_ARRAY_ITEMS).map(item => visit(item, depth + 1)).filter(item => item != null);
    }
    if (typeof current !== 'object') return null;

    const result: AssistantScreenContext = {};
    for (const [key, child] of Object.entries(current as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)) {
      if (remaining <= 0) break;
      const safeKey = key.trim().slice(0, 80);
      if (!safeKey || SENSITIVE_KEY.test(safeKey)) continue;
      const safeValue = visit(child, depth + 1);
      if (safeValue != null) result[safeKey] = safeValue;
    }
    return result;
  };

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sanitized = visit(value, 0);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) && Object.keys(sanitized).length > 0
    ? sanitized as AssistantScreenContext
    : null;
}